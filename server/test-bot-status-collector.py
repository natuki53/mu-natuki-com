import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("bot-status-collector.py")
SPEC = importlib.util.spec_from_file_location("bot_status_collector", MODULE_PATH)
bot_status_collector = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(bot_status_collector)

NOW = datetime(2026, 7, 29, 12, 0, tzinfo=timezone.utc)


def heartbeat(
    bot_id,
    *,
    heartbeat_at=NOW,
    connected=True,
    dependencies=None,
    extra=None,
):
    value = {
        "version": 1,
        "botId": bot_id,
        "processStartedAt": (NOW - timedelta(hours=2)).isoformat(),
        "heartbeatAt": heartbeat_at.isoformat(),
        "discordConnected": connected,
        "gatewayLatencyMs": 25 if connected else None,
        "dependencies": dependencies or [],
    }
    value.update(extra or {})
    return value


class BotStatusCollectorTests(unittest.TestCase):
    def write_heartbeat(self, root, bot_id, payload):
        path = root / bot_id / "status.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")

    def test_all_bots_online(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_heartbeat(root, "timecard", heartbeat("timecard"))
            self.write_heartbeat(
                root,
                "voicevox-tts",
                heartbeat(
                    "voicevox-tts",
                    dependencies=[{"id": "voicevox-engine", "connected": True}],
                    extra={"secret": "must-not-leak", "guilds": ["private"]},
                ),
            )
            self.write_heartbeat(root, "youtube", heartbeat("youtube"))

            snapshot = bot_status_collector.collect_snapshot(source_root=root, now=NOW)

            self.assertEqual(snapshot["status"], "operational")
            self.assertTrue(all(bot["state"] == "online" for bot in snapshot["bots"]))
            serialized = json.dumps(snapshot)
            self.assertNotIn("must-not-leak", serialized)
            self.assertNotIn("guilds", serialized)

    def test_one_stale_bot_degrades_and_all_stale_is_outage(self):
        stale_at = NOW - timedelta(seconds=36)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for bot_id in bot_status_collector.BOTS:
                dependencies = (
                    [{"id": "voicevox-engine", "connected": True}]
                    if bot_id == "voicevox-tts"
                    else []
                )
                self.write_heartbeat(
                    root,
                    bot_id,
                    heartbeat(bot_id, heartbeat_at=stale_at, dependencies=dependencies),
                )

            all_stale = bot_status_collector.collect_snapshot(source_root=root, now=NOW)
            self.assertEqual(all_stale["status"], "outage")
            self.assertTrue(all(bot["state"] == "offline" for bot in all_stale["bots"]))

            self.write_heartbeat(root, "timecard", heartbeat("timecard"))
            partial = bot_status_collector.collect_snapshot(source_root=root, now=NOW)
            self.assertEqual(partial["status"], "degraded")

    def test_dependency_failure_is_degraded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_heartbeat(
                root,
                "voicevox-tts",
                heartbeat(
                    "voicevox-tts",
                    dependencies=[{"id": "voicevox-engine", "connected": False}],
                ),
            )
            snapshot = bot_status_collector.collect_snapshot(source_root=root, now=NOW)
            voicevox = next(bot for bot in snapshot["bots"] if bot["id"] == "voicevox-tts")
            self.assertEqual(voicevox["state"], "degraded")
            self.assertEqual(voicevox["dependencies"][0]["state"], "offline")

    def test_disconnected_bot_is_degraded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_heartbeat(
                root,
                "timecard",
                heartbeat("timecard", connected=False),
            )

            snapshot = bot_status_collector.collect_snapshot(source_root=root, now=NOW)
            timecard = next(bot for bot in snapshot["bots"] if bot["id"] == "timecard")

            self.assertEqual(timecard["state"], "degraded")
            self.assertFalse(timecard["discordConnected"])
            self.assertIsNone(timecard["gatewayLatencyMs"])

    def test_missing_corrupt_and_future_versions_are_unknown(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            corrupt = root / "timecard" / "status.json"
            corrupt.parent.mkdir(parents=True)
            corrupt.write_text("{", encoding="utf-8")
            self.write_heartbeat(
                root,
                "youtube",
                heartbeat("youtube", extra={"version": 2}),
            )

            snapshot = bot_status_collector.collect_snapshot(source_root=root, now=NOW)

            self.assertEqual(snapshot["status"], "unavailable")
            self.assertTrue(all(bot["state"] == "unknown" for bot in snapshot["bots"]))

    def test_invalid_latency_and_dependencies_are_unknown(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            invalid_latency = heartbeat("timecard")
            invalid_latency["gatewayLatencyMs"] = "fast"
            self.write_heartbeat(root, "timecard", invalid_latency)
            self.write_heartbeat(
                root,
                "voicevox-tts",
                heartbeat("voicevox-tts", dependencies=[]),
            )
            self.write_heartbeat(root, "youtube", heartbeat("youtube"))

            snapshot = bot_status_collector.collect_snapshot(source_root=root, now=NOW)
            states = {bot["id"]: bot["state"] for bot in snapshot["bots"]}

            self.assertEqual(states["timecard"], "unknown")
            self.assertEqual(states["voicevox-tts"], "unknown")
            self.assertEqual(states["youtube"], "online")


if __name__ == "__main__":
    unittest.main()
