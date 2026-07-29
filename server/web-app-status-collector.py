#!/usr/bin/env python3
"""Check fixed public web applications and publish a small status snapshot."""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

OUTPUT_PATH = Path(os.environ.get("WEB_APP_STATUS_OUTPUT_PATH", "/data/web-app-status.json"))
INTERVAL_SECONDS = max(10, int(os.environ.get("WEB_APP_STATUS_INTERVAL_SECONDS", "30")))
REQUEST_TIMEOUT_SECONDS = max(
    1,
    int(os.environ.get("WEB_APP_STATUS_REQUEST_TIMEOUT_SECONDS", "5")),
)

APPS = (
    {
        "id": "neareats",
        "displayName": "NearEats",
        "url": "https://neareats.mu-natuki.com/",
    },
    {
        "id": "yorimo",
        "displayName": "Yorimo",
        "url": "https://yorimo.mu-natuki.com/",
    },
)

CheckResult = dict[str, Any]
Checker = Callable[[dict[str, str], datetime], CheckResult]


def _isoformat(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _state_for_http_status(status_code: int | None) -> str:
    if status_code is None or status_code >= 500:
        return "offline"
    if 200 <= status_code < 400:
        return "online"
    return "degraded"


def check_app(app: dict[str, str], checked_at: datetime) -> CheckResult:
    started_at = time.perf_counter()
    status_code: int | None = None
    request = Request(
        app["url"],
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": "mu-natuki-public-status/1.0",
        },
        method="GET",
    )

    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            status_code = response.getcode()
            response.read(1)
    except HTTPError as error:
        status_code = error.code
    except (OSError, TimeoutError, URLError):
        status_code = None

    response_time_ms = max(0, round((time.perf_counter() - started_at) * 1_000))
    return {
        "id": app["id"],
        "displayName": app["displayName"],
        "url": app["url"],
        "state": _state_for_http_status(status_code),
        "httpStatus": status_code,
        "responseTimeMs": response_time_ms,
        "lastCheckedAt": _isoformat(checked_at),
    }


def _overall_status(apps: list[CheckResult]) -> str:
    states = [app["state"] for app in apps]
    if all(state == "online" for state in states):
        return "operational"
    if all(state == "offline" for state in states):
        return "outage"
    return "degraded"


def collect_snapshot(
    *,
    checker: Checker = check_app,
    now: datetime | None = None,
) -> dict[str, Any]:
    measured_at = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    apps = [checker(app, measured_at) for app in APPS]
    return {
        "version": 1,
        "status": _overall_status(apps),
        "measuredAt": _isoformat(measured_at),
        "apps": apps,
    }


def write_snapshot(snapshot: dict[str, Any]) -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=OUTPUT_PATH.parent,
            prefix=".web-app-status-",
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
        if status != last_logged_status or started_at - last_logged_at >= 300:
            log = logging.info if status == "operational" else logging.warning
            log("Published public web app status snapshot (%s)", status)
            last_logged_status = status
            last_logged_at = started_at
        elapsed = time.monotonic() - started_at
        time.sleep(max(0.1, INTERVAL_SECONDS - elapsed))


if __name__ == "__main__":
    main()
