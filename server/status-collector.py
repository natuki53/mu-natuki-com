#!/usr/bin/env python3
"""Publish a small, fixed-schema status snapshot from a local Netdata Agent."""

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
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

NETDATA_BASE_URL = os.environ.get("NETDATA_BASE_URL", "http://127.0.0.1:19999").rstrip("/")
OUTPUT_PATH = Path(os.environ.get("STATUS_OUTPUT_PATH", "/data/server-status.json"))
INTERVAL_SECONDS = max(5, int(os.environ.get("STATUS_INTERVAL_SECONDS", "10")))
REQUEST_TIMEOUT_SECONDS = min(5, max(1, int(os.environ.get("STATUS_REQUEST_TIMEOUT_SECONDS", "3"))))

CHARTS = {
    "cpuPct": "system.cpu",
    "memoryPct": "system.ram",
    "diskPct": "disk_space./",
    "uptimeSeconds": "system.uptime",
}

ALLOWED_NETDATA_HOSTS = {"127.0.0.1", "localhost", "::1"}


def _validate_configuration() -> None:
    parsed = urlparse(NETDATA_BASE_URL)
    if parsed.scheme != "http" or parsed.hostname not in ALLOWED_NETDATA_HOSTS:
        raise ValueError("NETDATA_BASE_URL must use HTTP and resolve to the local host")


def _finite_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _clamp_percentage(value: float | None) -> float | None:
    if value is None:
        return None
    return round(min(100.0, max(0.0, value)), 1)


def _fetch_chart(chart: str) -> dict[str, Any]:
    query = urlencode(
        {
            "chart": chart,
            "format": "json",
            "points": "1",
            "group": "average",
            "after": f"-{max(15, INTERVAL_SECONDS * 2)}",
            "before": "0",
        }
    )
    request = Request(
        f"{NETDATA_BASE_URL}/api/v1/data?{query}",
        headers={"Accept": "application/json", "User-Agent": "mu-natuki-status-collector/1"},
    )
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        if response.status != 200:
            raise RuntimeError(f"Netdata returned HTTP {response.status}")
        return json.load(response)


def _last_sample(payload: dict[str, Any]) -> tuple[list[str], list[Any], int]:
    labels = payload.get("labels")
    rows = payload.get("data")
    if not isinstance(labels, list) or not isinstance(rows, list) or not rows:
        raise ValueError("Netdata response has no samples")

    row = rows[-1]
    if not isinstance(row, list) or len(row) != len(labels):
        raise ValueError("Netdata response has an invalid sample")

    timestamp = _finite_number(row[0])
    if timestamp is None or timestamp <= 0:
        raise ValueError("Netdata response has an invalid timestamp")
    return labels, row, int(timestamp)


def _dimension(labels: list[str], row: list[Any], name: str) -> float:
    try:
        value = _finite_number(row[labels.index(name)])
    except ValueError as error:
        raise ValueError(f"Netdata response is missing {name}") from error
    if value is None:
        raise ValueError(f"Netdata response has an invalid {name} value")
    return value


def _parse_cpu(labels: list[str], row: list[Any]) -> float:
    if "idle" in labels:
        return _clamp_percentage(100.0 - _dimension(labels, row, "idle")) or 0.0
    active = sum(_finite_number(value) or 0.0 for value in row[1:])
    return _clamp_percentage(active) or 0.0


def _parse_memory(labels: list[str], row: list[Any]) -> float:
    values = {name: _dimension(labels, row, name) for name in ("free", "used", "cached", "buffers")}
    total = sum(values.values())
    if total <= 0:
        raise ValueError("Netdata memory total is invalid")
    return _clamp_percentage((values["used"] / total) * 100.0) or 0.0


def _parse_disk(labels: list[str], row: list[Any]) -> float:
    used = _dimension(labels, row, "used")
    total = sum(_finite_number(value) or 0.0 for value in row[1:])
    if total <= 0:
        raise ValueError("Netdata disk total is invalid")
    return _clamp_percentage((used / total) * 100.0) or 0.0


def _parse_uptime(labels: list[str], row: list[Any]) -> int:
    return max(0, int(_dimension(labels, row, "uptime")))


PARSERS = {
    "cpuPct": _parse_cpu,
    "memoryPct": _parse_memory,
    "diskPct": _parse_disk,
    "uptimeSeconds": _parse_uptime,
}


def collect_snapshot() -> dict[str, Any]:
    snapshot: dict[str, Any] = {
        "version": 1,
        "status": "unavailable",
        "cpuPct": None,
        "memoryPct": None,
        "diskPct": None,
        "uptimeSeconds": None,
        "measuredAt": None,
    }
    timestamps: list[int] = []
    failures = 0

    for field, chart in CHARTS.items():
        try:
            labels, row, timestamp = _last_sample(_fetch_chart(chart))
            snapshot[field] = PARSERS[field](labels, row)
            timestamps.append(timestamp)
        except Exception as error:  # keep the other public metrics available
            failures += 1
            logging.warning("Could not collect %s: %s", field, error)

    if timestamps:
        snapshot["measuredAt"] = datetime.fromtimestamp(max(timestamps), timezone.utc).isoformat().replace(
            "+00:00", "Z"
        )
        snapshot["status"] = "ok" if failures == 0 else "partial"

    return snapshot


def write_snapshot(snapshot: dict[str, Any]) -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=OUTPUT_PATH.parent,
        prefix=".server-status-",
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


def main() -> None:
    _validate_configuration()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    while True:
        started_at = time.monotonic()
        snapshot = collect_snapshot()
        write_snapshot(snapshot)
        logging.info("Published server status snapshot (%s)", snapshot["status"])
        elapsed = time.monotonic() - started_at
        time.sleep(max(0.1, INTERVAL_SECONDS - elapsed))


if __name__ == "__main__":
    main()
