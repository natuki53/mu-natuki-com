#!/usr/bin/env python3
"""Publish a fixed-schema public snapshot from private bot heartbeat files."""

from __future__ import annotations

import json
import logging
import math
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SOURCES_ROOT = Path(os.environ.get("BOT_STATUS_SOURCES_ROOT", "/sources"))
OUTPUT_PATH = Path(os.environ.get("BOT_STATUS_OUTPUT_PATH", "/data/bot-status.json"))
INTERVAL_SECONDS = max(1, int(os.environ.get("BOT_STATUS_INTERVAL_SECONDS", "5")))
STALE_AFTER_SECONDS = max(15, int(os.environ.get("BOT_STATUS_STALE_AFTER_SECONDS", "35")))
MAX_FUTURE_SKEW_SECONDS = 5

BOTS = {
    "timecard": {
        "displayName": "Timecard Bot",
        "dependencies": {},
    },
    "voicevox-tts": {
        "displayName": "VOICEVOX読み上げBot",
        "dependencies": {
            "voicevox-engine": "VOICEVOX Engine",
        },
    },
    "youtube": {
        "displayName": "YouTube Bot",
        "dependencies": {},
    },
}


def _isoformat(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def _latency(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number) or number < 0 or number > 60_000:
        return None
    return round(number)


def _unknown_bot(bot_id: str) -> dict[str, Any]:
    return {
        "id": bot_id,
        "displayName": BOTS[bot_id]["displayName"],
        "state": "unknown",
        "uptimeSeconds": None,
        "discordConnected": None,
        "gatewayLatencyMs": None,
        "lastHeartbeatAt": None,
        "dependencies": [
            {
                "id": dependency_id,
                "displayName": display_name,
                "state": "unknown",
            }
            for dependency_id, display_name in BOTS[bot_id]["dependencies"].items()
        ],
    }


def _read_heartbeat(path: Path) -> dict[str, Any] | None:
    try:
        with path.open("r", encoding="utf-8") as heartbeat_file:
            payload = json.load(heartbeat_file)
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _dependencies(bot_id: str, payload: dict[str, Any]) -> list[dict[str, str]]:
    configured = BOTS[bot_id]["dependencies"]
    reported = payload.get("dependencies")
    reported_by_id: dict[str, bool] = {}
    if isinstance(reported, list):
        for item in reported:
            if not isinstance(item, dict):
                continue
            dependency_id = item.get("id")
            connected = item.get("connected")
            if dependency_id in configured and isinstance(connected, bool):
                reported_by_id[dependency_id] = connected

    return [
        {
            "id": dependency_id,
            "displayName": display_name,
            "state": (
                "online"
                if reported_by_id.get(dependency_id) is True
                else "offline"
                if reported_by_id.get(dependency_id) is False
                else "unknown"
            ),
        }
        for dependency_id, display_name in configured.items()
    ]


def _has_valid_dependency_schema(bot_id: str, payload: dict[str, Any]) -> bool:
    expected_ids = set(BOTS[bot_id]["dependencies"])
    reported = payload.get("dependencies")
    if not isinstance(reported, list):
        return False

    reported_ids: set[str] = set()
    for item in reported:
        if not isinstance(item, dict):
            return False
        dependency_id = item.get("id")
        if (
            dependency_id not in expected_ids
            or dependency_id in reported_ids
            or not isinstance(item.get("connected"), bool)
        ):
            return False
        reported_ids.add(dependency_id)
    return reported_ids == expected_ids


def _normalize_bot(bot_id: str, payload: dict[str, Any] | None, now: datetime) -> dict[str, Any]:
    if (
        payload is None
        or payload.get("version") != 1
        or payload.get("botId") != bot_id
        or not isinstance(payload.get("discordConnected"), bool)
        or not _has_valid_dependency_schema(bot_id, payload)
    ):
        return _unknown_bot(bot_id)

    heartbeat_at = _parse_datetime(payload.get("heartbeatAt"))
    process_started_at = _parse_datetime(payload.get("processStartedAt"))
    if heartbeat_at is None or process_started_at is None or process_started_at > heartbeat_at:
        return _unknown_bot(bot_id)

    age_seconds = (now - heartbeat_at).total_seconds()
    if age_seconds < -MAX_FUTURE_SKEW_SECONDS:
        return _unknown_bot(bot_id)

    stale = age_seconds > STALE_AFTER_SECONDS
    dependency_statuses = _dependencies(bot_id, payload)
    discord_connected = payload["discordConnected"]
    gateway_latency_ms = _latency(payload.get("gatewayLatencyMs"))
    if discord_connected and gateway_latency_ms is None:
        return _unknown_bot(bot_id)
    if not discord_connected and payload.get("gatewayLatencyMs") is not None:
        return _unknown_bot(bot_id)

    if stale:
        state = "offline"
        uptime_seconds = max(0, int((heartbeat_at - process_started_at).total_seconds()))
        public_discord_connected: bool | None = None
        public_gateway_latency_ms = None
    else:
        dependency_problem = any(item["state"] != "online" for item in dependency_statuses)
        state = "online" if discord_connected and not dependency_problem else "degraded"
        uptime_seconds = max(0, int((now - process_started_at).total_seconds()))
        public_discord_connected = discord_connected
        public_gateway_latency_ms = gateway_latency_ms if discord_connected else None

    return {
        "id": bot_id,
        "displayName": BOTS[bot_id]["displayName"],
        "state": state,
        "uptimeSeconds": uptime_seconds,
        "discordConnected": public_discord_connected,
        "gatewayLatencyMs": public_gateway_latency_ms,
        "lastHeartbeatAt": _isoformat(heartbeat_at),
        "dependencies": dependency_statuses,
    }


def _overall_status(bots: list[dict[str, Any]]) -> str:
    states = [bot["state"] for bot in bots]
    if all(state == "online" for state in states):
        return "operational"
    if all(state == "unknown" for state in states):
        return "unavailable"
    if all(state == "offline" for state in states):
        return "outage"
    return "degraded"


def collect_snapshot(
    *,
    source_root: Path = SOURCES_ROOT,
    now: datetime | None = None,
) -> dict[str, Any]:
    measured_at = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    bots = [
        _normalize_bot(
            bot_id,
            _read_heartbeat(source_root / bot_id / "status.json"),
            measured_at,
        )
        for bot_id in BOTS
    ]
    return {
        "version": 1,
        "status": _overall_status(bots),
        "measuredAt": _isoformat(measured_at),
        "bots": bots,
    }


def write_snapshot(snapshot: dict[str, Any]) -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=OUTPUT_PATH.parent,
            prefix=".bot-status-",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            json.dump(snapshot, temporary, ensure_ascii=False, separators=(",", ":"))
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
            temporary_path = Path(temporary.name)

        temporary_path.chmod(0o644)
        temporary_path.replace(OUTPUT_PATH)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    last_logged_status: str | None = None
    last_logged_at = 0.0

    while True:
        started_at = time.monotonic()
        snapshot = collect_snapshot()
        write_snapshot(snapshot)
        status = str(snapshot["status"])
        if status != last_logged_status or started_at - last_logged_at >= 60:
            log = logging.info if status == "operational" else logging.warning
            log("Published Discord bot status snapshot (%s)", status)
            last_logged_status = status
            last_logged_at = started_at
        elapsed = time.monotonic() - started_at
        time.sleep(max(0.1, INTERVAL_SECONDS - elapsed))


if __name__ == "__main__":
    main()
