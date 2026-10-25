import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("timecard_remote", Path(__file__).with_name("timecard_remote.py"))
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.local = Mock()
        self.client = Mock()
        self.app = remote.BridgeApplication({"timecardRemote": {
            "enabledFile": str(self.root / "enabled"),
            "maintenanceFile": str(self.root / "maintenance"),
            "heartbeatMirror": str(self.root / "status.json"),
        }}, local=self.local, remote=self.client)
        self.payload = {"method": "timecard.active", "actor": "admin@example.com", "params": {}}

    def enable(self):
        self.app.enabled_path.touch()

    def test_disabled_bridge_keeps_existing_backend(self):
        self.app.dispatch(self.payload)
        self.local.dispatch.assert_called_once_with(self.payload)
        self.client.call.assert_not_called()

    def test_enabled_timecard_routes_only_to_new_host(self):
        self.enable()
        self.app.dispatch(self.payload)
        self.client.call.assert_called_once_with(self.payload)
        self.local.dispatch.assert_not_called()

    def test_maintenance_blocks_corrections_and_actions_before_cutover(self):
        self.app.maintenance_path.touch()
        for payload in (self.payload, {**self.payload, "method": "services.action", "params": {"id": "timecard"}}):
            with self.assertRaises(remote.broker.BrokerError) as caught:
                self.app.dispatch(payload)
            self.assertEqual(caught.exception.status, 503)
        self.local.dispatch.assert_not_called()
        self.client.call.assert_not_called()

    def test_other_services_still_use_original_host(self):
        self.enable()
        payload = {**self.payload, "method": "services.action", "params": {"id": "youtube"}}
        self.app.dispatch(payload)
        self.local.dispatch.assert_called_once_with(payload)
        self.client.call.assert_not_called()

    def test_status_replaces_only_timecard(self):
        self.enable()
        self.local.dispatch.return_value = [{"id": "timecard", "state": "offline"}, {"id": "youtube", "state": "online"}]
        self.client.call.return_value = [{"id": "timecard", "state": "online"}]
        result = self.app.dispatch({**self.payload, "method": "services.list"})
        self.assertEqual([x["state"] for x in result], ["online", "online"])

    def test_unavailable_remote_does_not_hide_local_services(self):
        self.enable()
        self.local.dispatch.return_value = [{"id": "timecard"}, {"id": "youtube", "state": "online"}]
        self.client.call.side_effect = remote.broker.BrokerError(503, "unavailable")
        result = self.app.dispatch({**self.payload, "method": "services.list"})
        self.assertEqual(result[0]["state"], "unknown")
        self.assertEqual(result[1]["state"], "online")

    def test_relay_preserves_source_timestamp_and_public_schema(self):
        self.enable()
        heartbeat = {"version": 1, "botId": "timecard", "processStartedAt": "2026-01-01T00:00:00Z", "heartbeatAt": "2026-01-01T00:00:10Z", "discordConnected": True, "gatewayLatencyMs": 20, "dependencies": []}
        self.client.call.return_value = heartbeat
        self.app.relay_status_once()
        path = self.root / "status.json"
        self.assertEqual(json.loads(path.read_text()), heartbeat)
        self.client.call.return_value = {**heartbeat, "secret": "must-not-be-published"}
        with self.assertRaises(remote.broker.BrokerError):
            self.app.relay_status_once()
        self.assertEqual(json.loads(path.read_text()), heartbeat)
        self.client.call.side_effect = remote.broker.BrokerError(503, "unavailable")
        with self.assertRaises(remote.broker.BrokerError):
            self.app.relay_status_once()
        self.assertEqual(json.loads(path.read_text()), heartbeat)

    def test_audits_merge_and_deduplicate_copied_history(self):
        self.enable()
        old = {"category": "service", "id": "old", "created_at": "2026-01-01"}
        recent = {"category": "attendance", "id": "new", "created_at": "2026-10-25"}
        self.local.dispatch.return_value = [old]
        self.client.call.return_value = [recent, old]
        self.assertEqual(self.app.dispatch({**self.payload, "method": "audit.list"}), [recent, old])


class TransportTests(unittest.TestCase):
    def test_fixed_command_and_payload_on_stdin(self):
        runner = Mock(return_value=subprocess.CompletedProcess([], 0, b'{"ok":true,"result":[]}', b""))
        client = remote.RemoteClient({"host": "192.168.1.20", "user": "natuki", "knownHostsFile": "/fixed/hosts", "identityFile": "/fixed/key"}, runner)
        payload = {"method": "timecard.active", "actor": "admin@example.com", "params": {"unused": "$(id); echo secret"}}
        self.assertEqual(client.call(payload), [])
        args, kwargs = runner.call_args
        self.assertEqual(args[0][-1], "natuki@192.168.1.20")
        self.assertNotIn("$(id); echo secret", args[0])
        self.assertFalse(kwargs["shell"])
        self.assertEqual(json.loads(kwargs["input"]), payload)

    def test_failed_ssh_is_not_an_empty_success(self):
        runner = Mock(return_value=subprocess.CompletedProcess([], 255, b"", b"private diagnostic"))
        client = remote.RemoteClient({"host": "host", "user": "natuki", "knownHostsFile": "/hosts", "identityFile": "/key"}, runner)
        with self.assertRaises(remote.broker.BrokerError) as caught:
            client.call({})
        self.assertEqual(caught.exception.status, 503)
        self.assertNotIn("private diagnostic", caught.exception.message)


class WorkerTests(unittest.TestCase):
    def call(self, payload):
        return remote.worker_response(payload, Path("/runtime"), Path("/repo"), Path("/heartbeat"))

    @patch.dict(os.environ, {"SSH_ORIGINAL_COMMAND": "id"})
    def test_original_ssh_commands_are_rejected(self):
        with self.assertRaises(remote.broker.BrokerError) as caught:
            self.call({"method": "services.list"})
        self.assertEqual(caught.exception.status, 403)

    @patch.dict(os.environ, {"SSH_ORIGINAL_COMMAND": ""})
    def test_other_services_arbitrary_methods_and_arguments_are_rejected(self):
        for payload in (
            {"method": "shell.exec", "params": {}},
            {"method": "services.action", "params": {"id": "youtube"}},
            {"method": "services.action", "params": {"id": "timecard", "command": "id"}},
            {"method": "status.read", "params": {"path": "/etc/passwd"}},
        ):
            with self.subTest(payload=payload), self.assertRaises(remote.broker.BrokerError):
                self.call({**payload, "actor": "admin@example.com"})

    @patch.dict(os.environ, {"SSH_ORIGINAL_COMMAND": ""})
    @patch.object(remote, "unix_call", return_value={"ok": True, "result": []})
    def test_attendance_request_reaches_signed_local_broker(self, call):
        payload = {"method": "timecard.active", "actor": "admin@example.com", "params": {}}
        self.assertEqual(self.call(payload), {"ok": True, "result": []})
        call.assert_called_once_with(Path("/runtime"), payload)


if __name__ == "__main__":
    unittest.main()
