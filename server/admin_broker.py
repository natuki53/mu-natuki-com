#!/usr/bin/env python3
"""Fixed-capability broker for the private administration API."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
import re
import socketserver
import sqlite3
import subprocess
import threading
import uuid
from contextlib import closing, contextmanager
from pathlib import Path
from zoneinfo import ZoneInfo


JST = ZoneInfo("Asia/Tokyo")
MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
ALLOWED_ACTIONS = {"start", "stop", "restart"}
MAX_RPC_BYTES = 1024 * 1024


class BrokerError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso_utc(value: dt.datetime | None = None) -> str:
    return (value or utc_now()).astimezone(dt.timezone.utc).isoformat()


def require_uuid(value: object) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise BrokerError(400, "requestId must be a UUID") from exc


def canonical_json(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")


class AuditStore:
    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def ensure_schema(conn: sqlite3.Connection, prefix: str = "") -> None:
        schema = f"{prefix}." if prefix else ""
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {schema}service_audit (
                request_id TEXT PRIMARY KEY,
                actor TEXT NOT NULL,
                target_id TEXT NOT NULL,
                action TEXT NOT NULL,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                result_message TEXT NOT NULL
            )
            """
        )
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {schema}attendance_audit (
                audit_id TEXT PRIMARY KEY,
                request_id TEXT UNIQUE NOT NULL,
                actor TEXT NOT NULL,
                month TEXT NOT NULL,
                record_id INTEGER NOT NULL,
                reason TEXT NOT NULL,
                before_json TEXT NOT NULL,
                after_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )

    def _init_schema(self) -> None:
        with closing(self._connect()) as conn, conn:
            self.ensure_schema(conn)

    def find_service_request(self, request_id: str) -> dict | None:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT * FROM service_audit WHERE request_id = ?", (request_id,)
            ).fetchone()
        return dict(row) if row else None

    def start_service_request(
        self, request_id: str, actor: str, target_id: str, action: str
    ) -> dict | None:
        with self._lock, closing(self._connect()) as conn, conn:
            existing = conn.execute(
                "SELECT * FROM service_audit WHERE request_id = ?", (request_id,)
            ).fetchone()
            if existing:
                if (
                    existing["actor"] != actor
                    or existing["target_id"] != target_id
                    or existing["action"] != action
                ):
                    raise BrokerError(
                        409, "requestId was already used for another operation"
                    )
                return dict(existing)
            conn.execute(
                """
                INSERT INTO service_audit (
                    request_id, actor, target_id, action, status,
                    started_at, result_message
                ) VALUES (?, ?, ?, ?, 'running', ?, '')
                """,
                (request_id, actor, target_id, action, iso_utc()),
            )
        return None

    def finish_service_request(
        self, request_id: str, status: str, result_message: str
    ) -> None:
        with self._lock, closing(self._connect()) as conn, conn:
            conn.execute(
                """
                UPDATE service_audit
                SET status = ?, finished_at = ?, result_message = ?
                WHERE request_id = ?
                """,
                (status, iso_utc(), result_message[:300], request_id),
            )
            cutoff = iso_utc(utc_now() - dt.timedelta(days=90))
            conn.execute(
                "DELETE FROM service_audit WHERE started_at < ?", (cutoff,)
            )

    def list_entries(self, limit: int = 100) -> list[dict]:
        safe_limit = max(1, min(int(limit), 100))
        with closing(self._connect()) as conn:
            service_rows = conn.execute(
                """
                SELECT request_id AS id, actor, target_id AS target,
                       action, status, started_at AS created_at,
                       finished_at, result_message AS detail,
                       'service' AS category
                FROM service_audit
                """
            ).fetchall()
            attendance_rows = conn.execute(
                """
                SELECT audit_id AS id, actor,
                       month || ':' || record_id AS target,
                       'correct' AS action, 'succeeded' AS status,
                       created_at, created_at AS finished_at,
                       reason AS detail, 'attendance' AS category
                FROM attendance_audit
                """
            ).fetchall()
        entries = [dict(row) for row in (*service_rows, *attendance_rows)]
        entries.sort(key=lambda row: row["created_at"], reverse=True)
        return entries[:safe_limit]


class AttendanceStore:
    def __init__(self, db_dir: str, audit: AuditStore):
        self.db_dir = Path(db_dir)
        self.active_path = self.db_dir / "active_sessions.db"
        self.audit = audit

    @staticmethod
    def _month_parts(month: str) -> tuple[str, str]:
        if not MONTH_PATTERN.fullmatch(str(month)):
            raise BrokerError(400, "month must use YYYY-MM")
        return month.replace("-", "_"), month

    def _month_path(self, month: str) -> tuple[Path, str, str]:
        key, normalized = self._month_parts(month)
        path = self.db_dir / f"work_tracking_{key}.db"
        return path, f"history_{key}", normalized

    @staticmethod
    def _connect_readonly(path: Path) -> sqlite3.Connection:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def _parse_db_time(value: str) -> dt.datetime:
        return dt.datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=JST)

    @staticmethod
    def _format_api_time(value: str | None) -> str | None:
        if not value:
            return None
        return AttendanceStore._parse_db_time(value).isoformat()

    @staticmethod
    def _parse_api_time(value: object, field: str) -> str:
        try:
            parsed = dt.datetime.fromisoformat(str(value))
        except (TypeError, ValueError) as exc:
            raise BrokerError(400, f"{field} must be an ISO 8601 timestamp") from exc
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=JST)
        local = parsed.astimezone(JST).replace(tzinfo=None, microsecond=0)
        return local.strftime("%Y-%m-%d %H:%M:%S")

    def _member_names(self) -> dict[tuple[int, int], str]:
        if not self.active_path.is_file():
            return {}
        with closing(self._connect_readonly(self.active_path)) as conn:
            table = conn.execute(
                """
                SELECT 1 FROM sqlite_master
                WHERE type = 'table' AND name = 'member_directory'
                """
            ).fetchone()
            if not table:
                return {}
            rows = conn.execute(
                "SELECT guild_id, user_id, display_name FROM member_directory"
            ).fetchall()
        return {
            (int(row["guild_id"]), int(row["user_id"])): row["display_name"]
            for row in rows
        }

    @staticmethod
    def _row_version(row: sqlite3.Row | dict) -> str:
        values = {
            "id": row["id"],
            "guild_id": row["guild_id"],
            "user_id": row["user_id"],
            "start_time": row["start_time"],
            "end_time": row["end_time"],
            "total_break_duration": row["total_break_duration"],
            "work_duration": row["work_duration"],
        }
        return hashlib.sha256(canonical_json(values)).hexdigest()

    def _serialize_record(
        self, row: sqlite3.Row | dict, names: dict[tuple[int, int], str]
    ) -> dict:
        guild_id = int(row["guild_id"] or 0)
        user_id = int(row["user_id"])
        return {
            "id": int(row["id"]),
            "guildId": str(guild_id),
            "memberId": str(user_id),
            "displayName": names.get(
                (guild_id, user_id), f"Discord user …{str(user_id)[-4:]}"
            ),
            "startAt": self._format_api_time(row["start_time"]),
            "endAt": self._format_api_time(row["end_time"]),
            "breakSeconds": int(round(row["total_break_duration"] or 0)),
            "workSeconds": int(round(row["work_duration"] or 0)),
            "recordVersion": self._row_version(row),
        }

    def members(self) -> list[dict]:
        names = self._member_names()
        return [
            {
                "guildId": str(guild_id),
                "id": str(user_id),
                "displayName": display_name,
            }
            for (guild_id, user_id), display_name in sorted(
                names.items(), key=lambda item: item[1].casefold()
            )
        ]

    def active(self) -> list[dict]:
        if not self.active_path.is_file():
            return []
        names = self._member_names()
        now = dt.datetime.now(JST)
        with closing(self._connect_readonly(self.active_path)) as conn:
            rows = conn.execute(
                """
                SELECT guild_id, user_id, start_time, is_on_break,
                       break_start_time, total_break_duration
                FROM active_sessions
                ORDER BY start_time
                """
            ).fetchall()
        results = []
        for row in rows:
            started = self._parse_db_time(row["start_time"])
            elapsed = max(0, int((now - started).total_seconds()))
            break_seconds = int(round(row["total_break_duration"] or 0))
            if row["is_on_break"] and row["break_start_time"]:
                break_started = self._parse_db_time(row["break_start_time"])
                break_seconds += max(0, int((now - break_started).total_seconds()))
            guild_id = int(row["guild_id"])
            user_id = int(row["user_id"])
            results.append(
                {
                    "guildId": str(guild_id),
                    "memberId": str(user_id),
                    "displayName": names.get(
                        (guild_id, user_id),
                        f"Discord user …{str(user_id)[-4:]}",
                    ),
                    "startAt": started.isoformat(),
                    "state": "break" if row["is_on_break"] else "working",
                    "breakStartedAt": self._format_api_time(row["break_start_time"]),
                    "workSeconds": max(0, elapsed - break_seconds),
                }
            )
        return results

    def records(
        self,
        month: str,
        member_id: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> dict:
        path, table, normalized = self._month_path(month)
        safe_page = max(1, int(page))
        safe_size = max(1, min(int(page_size), 100))
        if not path.is_file():
            return {
                "month": normalized,
                "items": [],
                "total": 0,
                "page": safe_page,
                "pageSize": safe_size,
            }
        params: list[object] = []
        where = ""
        if member_id:
            if not str(member_id).isdigit():
                raise BrokerError(400, "memberId must be a Discord numeric ID")
            where = "WHERE user_id = ?"
            params.append(int(member_id))
        names = self._member_names()
        with closing(self._connect_readonly(path)) as conn:
            if not conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                (table,),
            ).fetchone():
                return {"month": normalized, "items": [], "total": 0}
            total = conn.execute(
                f"SELECT COUNT(*) FROM {table} {where}", params
            ).fetchone()[0]
            rows = conn.execute(
                f"""
                SELECT id, guild_id, user_id, start_time, end_time,
                       total_break_duration, work_duration
                FROM {table}
                {where}
                ORDER BY start_time DESC, id DESC
                LIMIT ? OFFSET ?
                """,
                (*params, safe_size, (safe_page - 1) * safe_size),
            ).fetchall()
        return {
            "month": normalized,
            "items": [self._serialize_record(row, names) for row in rows],
            "total": int(total),
            "page": safe_page,
            "pageSize": safe_size,
        }

    def summary(self, month: str, member_id: str | None = None) -> dict:
        data = self.records(month, member_id, 1, 100)
        path, table, normalized = self._month_path(month)
        if not path.is_file():
            return {
                "month": normalized,
                "memberId": str(member_id) if member_id else None,
                "shiftCount": 0,
                "workDayCount": 0,
                "breakSeconds": 0,
                "workSeconds": 0,
                "recordCount": 0,
            }
        params: list[object] = []
        where = ""
        if member_id:
            where = "WHERE user_id = ?"
            params.append(int(member_id))
        with closing(self._connect_readonly(path)) as conn:
            row = conn.execute(
                f"""
                SELECT COUNT(*) AS shifts,
                       COUNT(DISTINCT substr(start_time, 1, 10)) AS days,
                       COALESCE(SUM(total_break_duration), 0) AS breaks,
                       COALESCE(SUM(work_duration), 0) AS work
                FROM {table}
                {where}
                """,
                params,
            ).fetchone()
        return {
            "month": normalized,
            "memberId": str(member_id) if member_id else None,
            "shiftCount": int(row["shifts"]),
            "workDayCount": int(row["days"]),
            "breakSeconds": int(round(row["breaks"])),
            "workSeconds": int(round(row["work"])),
            "recordCount": data["total"],
        }

    def correct(
        self,
        month: str,
        record_id: int,
        payload: dict,
        actor: str,
        request_id: str,
    ) -> dict:
        path, table, normalized = self._month_path(month)
        if not path.is_file():
            raise BrokerError(404, "attendance month was not found")
        request_id = require_uuid(request_id)
        reason = " ".join(str(payload.get("reason") or "").split())
        if not 3 <= len(reason) <= 500:
            raise BrokerError(400, "reason must contain 3 to 500 characters")
        expected_version = str(payload.get("recordVersion") or "")
        if len(expected_version) != 64:
            raise BrokerError(400, "recordVersion is required")

        start_time = self._parse_api_time(payload.get("startAt"), "startAt")
        end_time = self._parse_api_time(payload.get("endAt"), "endAt")
        start_dt = self._parse_db_time(start_time)
        end_dt = self._parse_db_time(end_time)
        elapsed = int((end_dt - start_dt).total_seconds())
        if elapsed <= 0 or elapsed > 36 * 3600:
            raise BrokerError(400, "the shift must be between 1 second and 36 hours")
        try:
            break_seconds = int(payload.get("breakSeconds"))
        except (TypeError, ValueError) as exc:
            raise BrokerError(400, "breakSeconds must be an integer") from exc
        if break_seconds < 0 or break_seconds >= elapsed:
            raise BrokerError(400, "breakSeconds must be shorter than the shift")
        work_seconds = elapsed - break_seconds

        conn = sqlite3.connect(path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("ATTACH DATABASE ? AS audit", (self.audit.path,))
            AuditStore.ensure_schema(conn, "audit")
            conn.execute("BEGIN IMMEDIATE")
            duplicate = conn.execute(
                """
                SELECT actor, month, record_id, after_json
                FROM audit.attendance_audit
                WHERE request_id = ?
                """,
                (request_id,),
            ).fetchone()
            if duplicate:
                conn.rollback()
                after = json.loads(duplicate["after_json"])
                same_operation = (
                    duplicate["actor"] == actor
                    and duplicate["month"] == normalized
                    and int(duplicate["record_id"]) == int(record_id)
                    and after["start_time"] == start_time
                    and after["end_time"] == end_time
                    and int(after["total_break_duration"]) == break_seconds
                    and int(after["work_duration"]) == work_seconds
                )
                if not same_operation:
                    raise BrokerError(
                        409, "requestId was already used for another correction"
                    )
                return self._serialize_record(after, self._member_names())
            row = conn.execute(
                f"""
                SELECT id, guild_id, user_id, start_time, end_time,
                       total_break_duration, work_duration
                FROM {table}
                WHERE id = ?
                """,
                (int(record_id),),
            ).fetchone()
            if not row:
                conn.rollback()
                raise BrokerError(404, "attendance record was not found")
            if not row["end_time"]:
                conn.rollback()
                raise BrokerError(400, "active attendance cannot be corrected")
            if not hmac.compare_digest(self._row_version(row), expected_version):
                conn.rollback()
                raise BrokerError(409, "attendance record changed; reload and retry")

            before = dict(row)
            conn.execute(
                f"""
                UPDATE {table}
                SET start_time = ?, end_time = ?,
                    total_break_duration = ?, work_duration = ?
                WHERE id = ?
                """,
                (start_time, end_time, break_seconds, work_seconds, int(record_id)),
            )
            after = dict(before)
            after.update(
                {
                    "start_time": start_time,
                    "end_time": end_time,
                    "total_break_duration": break_seconds,
                    "work_duration": work_seconds,
                }
            )
            conn.execute(
                """
                INSERT INTO audit.attendance_audit (
                    audit_id, request_id, actor, month, record_id, reason,
                    before_json, after_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    request_id,
                    actor,
                    normalized,
                    int(record_id),
                    reason,
                    json.dumps(before, ensure_ascii=False),
                    json.dumps(after, ensure_ascii=False),
                    iso_utc(),
                ),
            )
            conn.commit()
        except Exception:
            if conn.in_transaction:
                conn.rollback()
            raise
        finally:
            conn.close()
        return self._serialize_record(after, self._member_names())


class ServiceController:
    def __init__(self, targets: dict, audit: AuditStore, runner=None):
        self.targets = targets
        self.audit = audit
        self.runner = runner or subprocess.run
        self._locks = {target_id: threading.Lock() for target_id in targets}

    def _run(self, args: list[str], timeout: int = 45) -> subprocess.CompletedProcess:
        return self.runner(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            shell=False,
        )

    def _target(self, target_id: str) -> dict:
        target = self.targets.get(target_id)
        if not target:
            raise BrokerError(404, "service target is not allowed")
        return target

    @staticmethod
    def _compose_prefix(target: dict) -> list[str]:
        command = ["docker", "compose", "--project-directory", target["composeDir"]]
        for compose_file in target.get("composeFiles", []):
            command.extend(["-f", compose_file])
        if target.get("envFile"):
            command.extend(["--env-file", target["envFile"]])
        return command

    @contextmanager
    def _deployment_guard(self, target: dict):
        lock_path = target.get("deployLockFile")
        if not lock_path:
            yield
            return
        import fcntl

        Path(lock_path).parent.mkdir(parents=True, exist_ok=True)
        with open(lock_path, "a+", encoding="utf-8") as lock_file:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise BrokerError(
                    409, "an automated deployment is currently running"
                ) from exc
            try:
                yield
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    def status(self, target_id: str) -> dict:
        target = self._target(target_id)
        components = []
        for name in target["containers"]:
            inspect = self._run(
                [
                    "docker",
                    "inspect",
                    "--format",
                    "{{json .State}}|{{.RestartCount}}",
                    name,
                ],
                timeout=10,
            )
            if inspect.returncode != 0:
                components.append(
                    {
                        "name": name,
                        "state": "stopped",
                        "health": None,
                        "startedAt": None,
                        "finishedAt": None,
                        "exitCode": None,
                        "oomKilled": False,
                        "restartCount": 0,
                        "cpuPct": None,
                        "memoryUsage": None,
                    }
                )
                continue
            state_json, restart_count = inspect.stdout.strip().rsplit("|", 1)
            state = json.loads(state_json)
            stats = self._run(
                ["docker", "stats", "--no-stream", "--format", "{{json .}}", name],
                timeout=10,
            )
            stats_data = {}
            if stats.returncode == 0 and stats.stdout.strip():
                try:
                    stats_data = json.loads(stats.stdout.strip().splitlines()[0])
                except json.JSONDecodeError:
                    stats_data = {}
            components.append(
                {
                    "name": name,
                    "state": "running" if state.get("Running") else "stopped",
                    "health": (state.get("Health") or {}).get("Status"),
                    "startedAt": state.get("StartedAt"),
                    "finishedAt": state.get("FinishedAt"),
                    "exitCode": state.get("ExitCode"),
                    "oomKilled": bool(state.get("OOMKilled")),
                    "restartCount": int(restart_count or 0),
                    "cpuPct": stats_data.get("CPUPerc"),
                    "memoryUsage": stats_data.get("MemUsage"),
                }
            )
        running = [item["state"] == "running" for item in components]
        unhealthy = any(item["health"] == "unhealthy" for item in components)
        if components and all(running) and not unhealthy:
            overall = "online"
        elif components and not any(running):
            overall = "offline"
        else:
            overall = "degraded"
        return {
            "id": target_id,
            "displayName": target["displayName"],
            "state": overall,
            "components": components,
        }

    def list_statuses(self) -> list[dict]:
        return [self.status(target_id) for target_id in self.targets]

    def action(
        self, target_id: str, action: str, actor: str, request_id: str
    ) -> dict:
        target = self._target(target_id)
        if action not in ALLOWED_ACTIONS:
            raise BrokerError(400, "action is not allowed")
        request_id = require_uuid(request_id)
        existing = self.audit.start_service_request(
            request_id, actor, target_id, action
        )
        if existing:
            return {
                "requestId": request_id,
                "status": existing["status"],
                "message": existing["result_message"],
            }
        lock = self._locks[target_id]
        if not lock.acquire(blocking=False):
            self.audit.finish_service_request(
                request_id, "rejected", "another operation is running"
            )
            raise BrokerError(409, "another operation is running for this service")
        try:
            with self._deployment_guard(target):
                prefix = self._compose_prefix(target)
                services = list(target["services"])
                if action == "start":
                    command = [*prefix, "up", "-d", "--no-build", *services]
                elif action == "stop":
                    command = [*prefix, "stop", "-t", "30", *services]
                else:
                    command = [*prefix, "restart", "-t", "30", *services]
                result = self._run(command, timeout=60)
            if result.returncode != 0:
                self.audit.finish_service_request(
                    request_id, "failed", "service operation failed"
                )
                raise BrokerError(502, "service operation failed")
            self.audit.finish_service_request(
                request_id, "succeeded", "service operation completed"
            )
            return {
                "requestId": request_id,
                "status": "succeeded",
                "message": "service operation completed",
                "service": self.status(target_id),
            }
        except BrokerError as exc:
            self.audit.finish_service_request(
                request_id,
                "rejected" if exc.status == 409 else "failed",
                exc.message,
            )
            raise
        except subprocess.TimeoutExpired as exc:
            self.audit.finish_service_request(
                request_id, "failed", "service operation timed out"
            )
            raise BrokerError(504, "service operation timed out") from exc
        finally:
            lock.release()


class BrokerApplication:
    def __init__(self, config: dict):
        audit = AuditStore(config["auditDbPath"])
        self.audit = audit
        self.attendance = AttendanceStore(config["timecardDbDir"], audit)
        self.services = ServiceController(config["targets"], audit)

    def dispatch(self, payload: dict) -> object:
        method = payload.get("method")
        params = payload.get("params") or {}
        actor = str(payload.get("actor") or "").strip().casefold()
        if not actor or len(actor) > 254:
            raise BrokerError(400, "actor is required")
        if method == "services.list":
            return self.services.list_statuses()
        if method == "services.action":
            return self.services.action(
                str(params.get("id")),
                str(params.get("action")),
                actor,
                str(params.get("requestId")),
            )
        if method == "timecard.members":
            return self.attendance.members()
        if method == "timecard.active":
            return self.attendance.active()
        if method == "timecard.records":
            return self.attendance.records(
                str(params.get("month")),
                params.get("memberId"),
                int(params.get("page", 1)),
                int(params.get("pageSize", 50)),
            )
        if method == "timecard.summary":
            return self.attendance.summary(
                str(params.get("month")), params.get("memberId")
            )
        if method == "timecard.correct":
            return self.attendance.correct(
                str(params.get("month")),
                int(params.get("recordId")),
                params,
                actor,
                str(params.get("requestId")),
            )
        if method == "audit.list":
            return self.audit.list_entries(int(params.get("limit", 100)))
        raise BrokerError(404, "broker method is not allowed")


class BrokerRequestHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        line = self.rfile.readline(MAX_RPC_BYTES + 1)
        if not line or len(line) > MAX_RPC_BYTES:
            return
        try:
            envelope = json.loads(line)
            payload = envelope["payload"]
            supplied = str(envelope["signature"])
            expected = hmac.new(
                self.server.shared_secret,
                canonical_json(payload),
                hashlib.sha256,
            ).hexdigest()
            if not hmac.compare_digest(supplied, expected):
                raise BrokerError(403, "invalid broker signature")
            result = self.server.application.dispatch(payload)
            response = {"ok": True, "result": result}
        except BrokerError as exc:
            response = {
                "ok": False,
                "error": {"status": exc.status, "message": exc.message},
            }
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            response = {
                "ok": False,
                "error": {"status": 400, "message": "invalid broker request"},
            }
        except Exception:
            response = {
                "ok": False,
                "error": {"status": 500, "message": "broker request failed"},
            }
        self.wfile.write(canonical_json(response) + b"\n")


class ThreadingUnixServer(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True


def serve(config: dict, socket_path: str, shared_secret: str) -> None:
    if len(shared_secret) < 32:
        raise RuntimeError("ADMIN_BROKER_SHARED_SECRET must contain at least 32 characters")
    path = Path(socket_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    server = ThreadingUnixServer(socket_path, BrokerRequestHandler)
    server.application = BrokerApplication(config)
    server.shared_secret = shared_secret.encode("utf-8")
    os.chmod(socket_path, 0o660)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        if path.exists():
            path.unlink()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--config",
        default=os.getenv("ADMIN_BROKER_CONFIG", "/etc/mu-admin/broker.json"),
    )
    parser.add_argument(
        "--socket",
        default=os.getenv(
            "ADMIN_BROKER_SOCKET", "/home/natuki/services/admin-runtime/control.sock"
        ),
    )
    args = parser.parse_args()
    with open(args.config, encoding="utf-8") as config_file:
        config = json.load(config_file)
    serve(config, args.socket, os.environ["ADMIN_BROKER_SHARED_SECRET"])


if __name__ == "__main__":
    main()
