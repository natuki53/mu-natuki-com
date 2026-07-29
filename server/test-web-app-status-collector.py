import importlib.util
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("web-app-status-collector.py")
SPEC = importlib.util.spec_from_file_location("web_app_status_collector", MODULE_PATH)
web_app_status_collector = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(web_app_status_collector)

NOW = datetime(2026, 7, 29, 12, 0, tzinfo=timezone.utc)


def result_for(state_by_id):
    def checker(app, checked_at):
        state = state_by_id[app["id"]]
        status_code = {"online": 200, "degraded": 429, "offline": None}[state]
        return {
            "id": app["id"],
            "displayName": app["displayName"],
            "url": app["url"],
            "state": state,
            "httpStatus": status_code,
            "responseTimeMs": 20,
            "lastCheckedAt": web_app_status_collector._isoformat(checked_at),
        }

    return checker


class WebAppStatusCollectorTests(unittest.TestCase):
    def test_all_apps_online(self):
        snapshot = web_app_status_collector.collect_snapshot(
            checker=result_for({"neareats": "online", "yorimo": "online"}),
            now=NOW,
        )

        self.assertEqual(snapshot["status"], "operational")
        self.assertEqual([app["id"] for app in snapshot["apps"]], ["neareats", "yorimo"])
        self.assertTrue(all(app["state"] == "online" for app in snapshot["apps"]))

    def test_partial_failure_is_degraded(self):
        snapshot = web_app_status_collector.collect_snapshot(
            checker=result_for({"neareats": "online", "yorimo": "offline"}),
            now=NOW,
        )

        self.assertEqual(snapshot["status"], "degraded")

    def test_all_apps_offline_is_outage(self):
        snapshot = web_app_status_collector.collect_snapshot(
            checker=result_for({"neareats": "offline", "yorimo": "offline"}),
            now=NOW,
        )

        self.assertEqual(snapshot["status"], "outage")

    def test_http_status_classification(self):
        self.assertEqual(web_app_status_collector._state_for_http_status(200), "online")
        self.assertEqual(web_app_status_collector._state_for_http_status(302), "online")
        self.assertEqual(web_app_status_collector._state_for_http_status(429), "degraded")
        self.assertEqual(web_app_status_collector._state_for_http_status(503), "offline")
        self.assertEqual(web_app_status_collector._state_for_http_status(None), "offline")

    def test_snapshot_is_written_atomically(self):
        snapshot = web_app_status_collector.collect_snapshot(
            checker=result_for({"neareats": "online", "yorimo": "online"}),
            now=NOW,
        )
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "web-app-status.json"
            with patch.object(web_app_status_collector, "OUTPUT_PATH", output_path):
                web_app_status_collector.write_snapshot(snapshot)

            self.assertTrue(output_path.exists())
            self.assertEqual(
                [path.name for path in Path(directory).iterdir()],
                ["web-app-status.json"],
            )


if __name__ == "__main__":
    unittest.main()
