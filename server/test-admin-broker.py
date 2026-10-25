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
                CREATE TABLE break_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    break_start TEXT NOT NULL,
                    break_end TEXT
                );
                INSERT INTO member_directory
                VALUES (10, 20, '雨苺 なつき', '2026-07-01T00:00:00Z');
                INSERT INTO active_sessions
                VALUES (
                    0, 20, '2026-07-30 09:00:00',
                    0, NULL, 0
                );
                INSERT INTO active_sessions
                VALUES (
                    10, 99, '2026-07-28 00:00:00',
                    0, NULL, 0
                );
                INSERT INTO active_sessions
                VALUES (
                    10, 100, '2026-07-30 03:00:00',
                    1, '2026-07-30 04:00:00', 0
                );
                INSERT INTO break_records (
                    guild_id, user_id, break_start, break_end
                ) VALUES (
                    10, 100, '2026-07-30 04:00:00', NULL
                );
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
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY,
                    start_time TEXT,
                    is_on_break INTEGER,
                    break_start_time TEXT,
                    total_break_duration REAL
                );
                INSERT INTO users
                VALUES (99, '2026-07-28 00:00:00', 0, NULL, 0);
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
        self.assertEqual(summary["excludedRecordCount"], 0)

    def test_active_excludes_legacy_sessions_and_keeps_long_breaks(self):
        items = self.store.active(
            dt.datetime(2026, 7, 30, 12, 0, tzinfo=dt.timezone(dt.timedelta(hours=9)))
        )
        self.assertEqual(len(items), 2)
        by_member = {item["memberId"]: item for item in items}
        current = by_member["20"]
        self.assertEqual(current["displayName"], "雨苺 なつき")
        self.assertEqual(current["startAt"], "2026-07-30T09:00:00+09:00")
        self.assertEqual(current["elapsedSeconds"], 10800)
        self.assertEqual(current["breakSeconds"], 0)
        self.assertEqual(current["workSeconds"], 10800)
        long_break = by_member["100"]
        self.assertEqual(long_break["state"], "break")
        self.assertEqual(long_break["breakSeconds"], 28800)
        self.assertEqual(long_break["currentBreakSeconds"], 28800)
        self.assertEqual(long_break["workSeconds"], 3600)

    def test_records_resolve_legacy_guild_member_name(self):
        with sqlite3.connect(self.month_path) as conn:
            conn.execute(
                "UPDATE history_2026_07 SET guild_id = 0 WHERE id = 1"
            )
        item = self.store.records("2026-07")["items"][0]
        self.assertEqual(item["displayName"], "雨苺 なつき")

    def test_records_and_summary_deduplicate_retried_shift(self):
        with sqlite3.connect(self.month_path) as conn:
            conn.execute(
                """
                INSERT INTO history_2026_07
                VALUES (
                    2, 10, 20,
                    '2026-07-01 09:00:00',
                    '2026-07-01 19:00:00',
                    3600, 32400
                )
                """
            )
        data = self.store.records("2026-07")
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["id"], 2)
        summary = self.store.summary("2026-07")
        self.assertEqual(summary["shiftCount"], 1)
        self.assertEqual(summary["workSeconds"], 32400)

    def test_all_member_work_days_are_summed_per_member(self):
        with sqlite3.connect(self.month_path) as conn:
            conn.executemany(
                """
                INSERT INTO history_2026_07
                VALUES (?, 10, 99, ?, ?, 0, 3600)
                """,
                [
                    (
                        2,
                        "2026-07-01 10:00:00",
                        "2026-07-01 11:00:00",
                    ),
                    (
                        3,
                        "2026-07-02 10:00:00",
                        "2026-07-02 11:00:00",
                    ),
                ],
            )
        summary = self.store.summary("2026-07")
        self.assertEqual(summary["shiftCount"], 3)
        self.assertEqual(summary["workDayCount"], 3)

    def test_records_and_summary_exclude_implausible_shifts(self):
        with sqlite3.connect(self.month_path) as conn:
            conn.execute(
                """
                INSERT INTO users
                VALUES (20, '2026-07-02 09:00:00', 0, NULL, 0)
                """
            )
            conn.executemany(
                """
                INSERT INTO history_2026_07
                VALUES (?, 10, 20, ?, ?, ?, ?)
                """,
                [
                    (
                        2,
                        "2026-07-02 09:00:00",
                        "2026-07-03 10:00:00",
                        86400,
                        3600,
                    ),
                    (
                        3,
                        "2026-07-04 09:00:00",
                        "2026-07-04 17:00:00",
                        36000,
                        3600,
                    ),
                ],
            )
        data = self.store.records("2026-07")
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["excludedTotal"], 2)
        self.assertEqual([item["id"] for item in data["items"]], [1])
        summary = self.store.summary("2026-07")
        self.assertEqual(summary["shiftCount"], 1)
        self.assertEqual(summary["breakSeconds"], 3600)
        self.assertEqual(summary["workSeconds"], 28800)
        self.assertEqual(summary["excludedRecordCount"], 2)

    def test_records_include_long_non_legacy_shift(self):
        with sqlite3.connect(self.month_path) as conn:
            conn.execute(
                """
                INSERT INTO history_2026_07
                VALUES (
                    2, 10, 20,
                    '2026-07-02 09:00:00',
                    '2026-07-03 10:00:00',
                    86400, 3600
                )
                """
            )
        data = self.store.records("2026-07")
        self.assertEqual(data["total"], 2)
        self.assertEqual(data["excludedTotal"], 0)
        summary = self.store.summary("2026-07")
        self.assertEqual(summary["shiftCount"], 2)
        self.assertEqual(summary["workSeconds"], 32400)
        self.assertEqual(summary["breakSeconds"], 90000)

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
                args,
                0,
                "".join(
                    f"{json.dumps(state)}|2|/{name}\n" for name in args[4:]
                ),
                "",
            )
        return subprocess.CompletedProcess(args, 0, "", "")


class ServiceControllerTests(unittest.TestCase):
    def test_statuses_are_batched_and_cached_without_docker_stats(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            audit = AuditStore(os.path.join(temp_dir, "audit.db"))
            runner = FakeRunner()
            controller = ServiceController(
                {
                    "first": {
                        "displayName": "First",
                        "containers": ["first-app", "shared-worker"],
                    },
                    "second": {
                        "displayName": "Second",
                        "containers": ["shared-worker", "second-app"],
                    },
                },
                audit,
                runner,
            )

            first_result = controller.list_statuses()
            second_result = controller.list_statuses()

            inspect_commands = [
                command
                for command in runner.commands
                if command[:2] == ["docker", "inspect"]
            ]
            stats_commands = [
                command
                for command in runner.commands
                if command[:2] == ["docker", "stats"]
            ]
            self.assertEqual(first_result, second_result)
            self.assertEqual(len(inspect_commands), 1)
            self.assertEqual(
                inspect_commands[0][4:],
                ["first-app", "shared-worker", "second-app"],
            )
            self.assertEqual(stats_commands, [])
            self.assertEqual(first_result[0]["state"], "online")
            self.assertIsNone(first_result[0]["components"][0]["cpuPct"])

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
