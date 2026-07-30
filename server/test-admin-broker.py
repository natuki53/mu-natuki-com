import datetime as dt
import json
import os
import sqlite3
import subprocess
import tempfile
import unittest
import uuid

from admin_broker import (
    AuditStore,
    AttendanceStore,
    BrokerError,
    ServiceController,
)


class AttendanceStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_dir = self.temp_dir.name
        self.active_path = os.path.join(self.db_dir, "active_sessions.db")
        self.month_path = os.path.join(
            self.db_dir, "work_tracking_2026_07.db"
        )
        self.audit = AuditStore(os.path.join(self.db_dir, "admin_audit.db"))
        with sqlite3.connect(self.active_path) as conn:
            conn.executescript(
                """
                CREATE TABLE active_sessions (
                    guild_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    start_time TEXT,
                    is_on_break INTEGER,
                    break_start_time TEXT,
                    total_break_duration REAL,
                    PRIMARY KEY (guild_id, user_id)
                );
                CREATE TABLE member_directory (
                    guild_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    display_name TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (guild_id, user_id)
                );
                INSERT INTO member_directory
                VALUES (10, 20, '雨苺 なつき', '2026-07-01T00:00:00Z');
                """
            )
        with sqlite3.connect(self.month_path) as conn:
            conn.executescript(
                """
                CREATE TABLE history_2026_07 (
                    id INTEGER PRIMARY KEY,
                    guild_id INTEGER,
                    user_id INTEGER,
                    start_time TEXT,
                    end_time TEXT,
                    total_break_duration REAL,
                    work_duration REAL
                );
                INSERT INTO history_2026_07
                VALUES (
                    1, 10, 20,
                    '2026-07-01 09:00:00',
                    '2026-07-01 18:00:00',
                    3600, 28800
                );
                """
            )
        self.store = AttendanceStore(self.db_dir, self.audit)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_records_and_summary_use_member_directory(self):
        data = self.store.records("2026-07")
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["displayName"], "雨苺 なつき")
        summary = self.store.summary("2026-07")
        self.assertEqual(summary["workSeconds"], 28800)
        self.assertEqual(summary["shiftCount"], 1)

    def test_missing_month_is_empty(self):
        data = self.store.records("2026-08")
        self.assertEqual(data["items"], [])
        self.assertEqual(data["total"], 0)
        summary = self.store.summary("2026-08")
        self.assertEqual(summary["shiftCount"], 0)
        self.assertEqual(summary["workSeconds"], 0)

    def test_correction_is_atomic_and_versioned(self):
        before = self.store.records("2026-07")["items"][0]
        request_id = str(uuid.uuid4())
        corrected = self.store.correct(
            "2026-07",
            1,
            {
                "startAt": "2026-07-01T09:30:00+09:00",
                "endAt": "2026-07-01T18:00:00+09:00",
                "breakSeconds": 1800,
                "reason": "休憩時間の訂正",
                "recordVersion": before["recordVersion"],
            },
            "admin@example.com",
            request_id,
        )
        self.assertEqual(corrected["workSeconds"], 28800)
        self.assertNotEqual(corrected["recordVersion"], before["recordVersion"])

        duplicate = self.store.correct(
            "2026-07",
            1,
            {
                "startAt": "2026-07-01T09:30:00+09:00",
                "endAt": "2026-07-01T18:00:00+09:00",
                "breakSeconds": 1800,
                "reason": "休憩時間の訂正",
                "recordVersion": before["recordVersion"],
            },
            "admin@example.com",
            request_id,
        )
        self.assertEqual(duplicate["recordVersion"], corrected["recordVersion"])

        with self.assertRaises(BrokerError) as duplicate_context:
            self.store.correct(
                "2026-07",
                1,
                {
                    "startAt": "2026-07-01T09:45:00+09:00",
                    "endAt": "2026-07-01T18:00:00+09:00",
                    "breakSeconds": 1800,
                    "reason": "別内容での再利用",
                    "recordVersion": before["recordVersion"],
                },
                "admin@example.com",
                request_id,
            )
        self.assertEqual(duplicate_context.exception.status, 409)

        with sqlite3.connect(self.audit.path) as conn:
            audit_count = conn.execute(
                "SELECT COUNT(*) FROM attendance_audit"
            ).fetchone()[0]
        self.assertEqual(audit_count, 1)

        with self.assertRaises(BrokerError) as context:
            self.store.correct(
                "2026-07",
                1,
                {
                    "startAt": "2026-07-01T09:00:00+09:00",
                    "endAt": "2026-07-01T18:00:00+09:00",
                    "breakSeconds": 0,
                    "reason": "古い画面からの更新",
                    "recordVersion": before["recordVersion"],
                },
                "admin@example.com",
                str(uuid.uuid4()),
            )
        self.assertEqual(context.exception.status, 409)


class FakeRunner:
    def __init__(self):
        self.commands = []

    def __call__(self, args, **_kwargs):
        self.commands.append(args)
        if args[:2] == ["docker", "inspect"]:
            state = {
                "Running": True,
                "Health": {"Status": "healthy"},
                "StartedAt": "2026-07-01T00:00:00Z",
                "FinishedAt": "0001-01-01T00:00:00Z",
                "ExitCode": 0,
                "OOMKilled": False,
            }
            return subprocess.CompletedProcess(
                args, 0, json.dumps(state) + "|2\n", ""
            )
        if args[:2] == ["docker", "stats"]:
            return subprocess.CompletedProcess(
                args,
                0,
                json.dumps({"CPUPerc": "1.2%", "MemUsage": "20MiB / 1GiB"}),
                "",
            )
        return subprocess.CompletedProcess(args, 0, "", "")


class ServiceControllerTests(unittest.TestCase):
    def test_only_fixed_compose_arguments_are_used(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            audit = AuditStore(os.path.join(temp_dir, "audit.db"))
            runner = FakeRunner()
            controller = ServiceController(
                {
                    "youtube": {
                        "displayName": "YouTube Bot",
                        "composeDir": "/srv/youtube",
                        "composeFiles": ["/srv/youtube/docker-compose.yml"],
                        "services": ["youtube-bot"],
                        "containers": ["youtube-bot"],
                    }
                },
                audit,
                runner,
            )
            result = controller.action(
                "youtube",
                "restart",
                "admin@example.com",
                str(uuid.uuid4()),
            )
            self.assertEqual(result["status"], "succeeded")
            action_command = next(
                command for command in runner.commands if "restart" in command
            )
            self.assertEqual(
                action_command,
                [
                    "docker",
                    "compose",
                    "--project-directory",
                    "/srv/youtube",
                    "-f",
                    "/srv/youtube/docker-compose.yml",
                    "restart",
                    "-t",
                    "30",
                    "youtube-bot",
                ],
            )
            request_id = str(uuid.uuid4())
            controller.action(
                "youtube",
                "restart",
                "admin@example.com",
                request_id,
            )
            with self.assertRaises(BrokerError) as duplicate_context:
                controller.action(
                    "youtube",
                    "stop",
                    "admin@example.com",
                    request_id,
                )
            self.assertEqual(duplicate_context.exception.status, 409)
            with self.assertRaises(BrokerError):
                controller.action(
                    "../../host",
                    "restart",
                    "admin@example.com",
                    str(uuid.uuid4()),
                )


if __name__ == "__main__":
    unittest.main()
