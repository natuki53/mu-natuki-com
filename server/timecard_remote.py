"""Forward only Timecard capabilities over a forced-command SSH connection."""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import logging
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading

import admin_broker as broker

LOG = logging.getLogger(__name__)
ATTENDANCE_METHODS = {
    "timecard.members", "timecard.active", "timecard.records",
    "timecard.summary", "timecard.correct",
}
WORKER_METHODS = ATTENDANCE_METHODS | {
    "services.list", "services.action", "audit.list", "status.read", "deploy.request",
}


class RemoteClient:
    def __init__(self, config: dict, runner=None):
        self.config = config
        self.runner = runner or subprocess.run

    def call(self, payload: dict, timeout: int = 65):
        config = self.config
        command = [
            "/usr/bin/ssh", "-F", "/dev/null", "-T",
            "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
            "-o", "IdentityAgent=none", "-o", "StrictHostKeyChecking=yes",
            "-o", "ConnectTimeout=5", "-o", "ServerAliveInterval=10",
            "-o", "ServerAliveCountMax=2",
            "-o", f"UserKnownHostsFile={config['knownHostsFile']}",
            "-i", config["identityFile"], f"{config['user']}@{config['host']}",
        ]
        request = broker.canonical_json(payload) + b"\n"
        if len(request) > broker.MAX_RPC_BYTES:
            raise broker.BrokerError(400, "Timecard request is too large")
        try:
            result = self.runner(
                command, input=request, capture_output=True, timeout=timeout,
                check=False, shell=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise broker.BrokerError(503, "Timecard host is unavailable") from exc
        if result.returncode or len(result.stdout) > broker.MAX_RPC_BYTES:
            raise broker.BrokerError(503, "Timecard host is unavailable")
        try:
            response = json.loads(result.stdout)
            if response.get("ok") is not True:
                error = response.get("error", {})
                status = int(error.get("status", 502))
                raise broker.BrokerError(
                    status if 400 <= status <= 599 else 502,
                    str(error.get("message", "Timecard request failed"))[:300],
                )
            return response["result"]
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise broker.BrokerError(502, "invalid Timecard host response") from exc


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".timecard-", delete=False) as f:
            temporary = Path(f.name)
            f.write(broker.canonical_json(value) + b"\n")
            f.flush()
            os.fsync(f.fileno())
        temporary.chmod(0o644)
        temporary.replace(path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


class BridgeApplication:
    def __init__(self, config: dict, local=None, remote=None):
        self.local = local or broker.BrokerApplication(config)
        self.settings = config["timecardRemote"]
        self.remote = remote or RemoteClient(self.settings)
        self.enabled_path = Path(self.settings["enabledFile"])
        self.maintenance_path = Path(self.settings["maintenanceFile"])
        self.stop_event = threading.Event()

    def dispatch(self, payload: dict):
        method = payload.get("method")
        params = payload.get("params") or {}
        actor = payload.get("actor")
        if not isinstance(params, dict) or not isinstance(actor, str) or not actor.strip() or len(actor) > 254:
            raise broker.BrokerError(400, "invalid broker request")
        is_timecard = method in ATTENDANCE_METHODS or (
            method == "services.action" and params.get("id") == "timecard"
        )
        if is_timecard and self.maintenance_path.exists():
            raise broker.BrokerError(503, "Timecard migration is in progress")
        if not self.enabled_path.exists():
            return self.local.dispatch(payload)
        if is_timecard:
            return self.remote.call(payload)
        if method == "services.list":
            local_items = self.local.dispatch(payload)
            try:
                remote_items = self.remote.call(payload)
                if len(remote_items) != 1 or remote_items[0].get("id") != "timecard":
                    raise broker.BrokerError(502, "invalid Timecard service response")
                timecard = remote_items[0]
            except broker.BrokerError:
                timecard = {"id": "timecard", "displayName": "Timecard Bot", "state": "unknown", "components": []}
            return [timecard if item["id"] == "timecard" else item for item in local_items]
        if method == "audit.list":
            limit = max(1, min(int(params.get("limit", 100)), 100))
            entries = [*self.local.dispatch(payload), *self.remote.call(payload)]
            unique = {(item["category"], item["id"]): item for item in entries}
            return sorted(unique.values(), key=lambda item: item["created_at"], reverse=True)[:limit]
        return self.local.dispatch(payload)

    def relay_status_once(self):
        if not self.enabled_path.exists():
            return
        heartbeat = self.remote.call({"method": "status.read", "actor": "status-relay", "params": {}}, timeout=8)
        allowed = {"version", "botId", "processStartedAt", "heartbeatAt", "discordConnected", "gatewayLatencyMs", "dependencies"}
        if not isinstance(heartbeat, dict) or set(heartbeat) != allowed or heartbeat.get("botId") != "timecard":
            raise broker.BrokerError(502, "invalid Timecard heartbeat")
        # Preserve the source timestamp: a broken relay must become stale/offline.
        atomic_json(Path(self.settings["heartbeatMirror"]), heartbeat)

    def _status_loop(self):
        while not self.stop_event.is_set():
            try:
                self.relay_status_once()
            except (broker.BrokerError, OSError):
                LOG.warning("Timecard heartbeat relay unavailable")
            self.stop_event.wait(10)

    def _deployment_loop(self):
        request_path = Path(self.settings["deployRequestFile"])
        working_path = request_path.with_suffix(".working")
        while not self.stop_event.is_set():
            if self.enabled_path.exists() and not self.maintenance_path.exists() and (request_path.exists() or working_path.exists()):
                try:
                    if request_path.exists():
                        request_path.replace(working_path)
                    result = self.remote.call({"method": "deploy.request", "actor": "deploy-webhook", "params": {}}, timeout=900)
                    atomic_json(Path(self.settings["deployResultFile"]), {"ok": True, "result": result})
                    working_path.unlink(missing_ok=True)
                except (broker.BrokerError, OSError):
                    LOG.warning("Timecard deployment relay failed; retaining request for retry")
                    atomic_json(Path(self.settings["deployResultFile"]), {"ok": False, "error": "remote deployment failed"})
                    if working_path.exists() and not request_path.exists():
                        working_path.replace(request_path)
                    self.stop_event.wait(60)
            self.stop_event.wait(3)

    def start_relays(self):
        for target in (self._status_loop, self._deployment_loop):
            threading.Thread(target=target, daemon=True).start()


def unix_call(runtime: Path, payload: dict):
    env = {}
    for line in (runtime / "broker.env").read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            env[key] = value
    secret = env["ADMIN_BROKER_SHARED_SECRET"].encode()
    if len(secret) < 32:
        raise broker.BrokerError(503, "Timecard broker is unavailable")
    signature = hmac.new(secret, broker.canonical_json(payload), hashlib.sha256).hexdigest()
    envelope = {"payload": payload, "signature": signature}
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(65)
        connection.connect(str(runtime / "control.sock"))
        connection.sendall(broker.canonical_json(envelope) + b"\n")
        response = bytearray()
        while b"\n" not in response:
            chunk = connection.recv(65536)
            if not chunk:
                break
            response.extend(chunk)
            if len(response) > broker.MAX_RPC_BYTES:
                raise broker.BrokerError(502, "Timecard response is too large")
    return json.loads(response)


def worker_response(payload: dict, runtime: Path, repo: Path, heartbeat: Path):
    if os.getenv("SSH_ORIGINAL_COMMAND"):
        raise broker.BrokerError(403, "SSH commands are not allowed")
    if not isinstance(payload, dict) or payload.get("method") not in WORKER_METHODS:
        raise broker.BrokerError(404, "remote capability is not allowed")
    params = payload.get("params") or {}
    actor = payload.get("actor")
    if not isinstance(params, dict) or not isinstance(actor, str) or not actor.strip() or len(actor) > 254:
        raise broker.BrokerError(400, "invalid remote request")
    method = payload["method"]
    if method == "services.action" and (params.get("id") != "timecard" or set(params) - {"id", "action", "requestId"}):
        raise broker.BrokerError(403, "remote service is not allowed")
    if method in {"status.read", "deploy.request", "services.list"} and params:
        raise broker.BrokerError(400, "unexpected remote parameters")
    if method == "status.read":
        if heartbeat.stat().st_size > 8192:
            raise broker.BrokerError(502, "invalid heartbeat")
        return {"ok": True, "result": json.loads(heartbeat.read_text())}
    if method == "deploy.request":
        log_path = runtime / "deploy.log"
        with log_path.open("ab") as log:
            result = subprocess.run(
                ["/bin/bash", str(repo / "scripts/deploy.sh")],
                cwd=repo, stdout=log, stderr=log, timeout=850, check=False,
                env={**os.environ, "DEPLOY_DIR": str(repo), "DB_VOLUME": str(repo / "db")},
            )
        if result.returncode:
            raise broker.BrokerError(502, "Timecard deployment failed")
        return {"ok": True, "result": {"status": "completed"}}
    return unix_call(runtime, payload)


def run_worker(args):
    try:
        line = sys.stdin.buffer.readline(broker.MAX_RPC_BYTES + 1)
        if len(line) > broker.MAX_RPC_BYTES:
            raise broker.BrokerError(400, "remote request is too large")
        response = worker_response(json.loads(line), Path(args.runtime), Path(args.repo), Path(args.heartbeat))
    except broker.BrokerError as exc:
        response = {"ok": False, "error": {"status": exc.status, "message": exc.message}}
    except (ValueError, KeyError, TypeError):
        response = {"ok": False, "error": {"status": 400, "message": "invalid remote request"}}
    except Exception:
        response = {"ok": False, "error": {"status": 503, "message": "Timecard capability is unavailable"}}
    sys.stdout.buffer.write(broker.canonical_json(response) + b"\n")


def run_bridge(args):
    config = json.loads(Path(args.config).read_text())
    secret = os.environ["ADMIN_BROKER_SHARED_SECRET"]
    if len(secret) < 32:
        raise RuntimeError("broker shared secret is too short")
    path = Path(args.socket)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.unlink(missing_ok=True)
    application = BridgeApplication(config)
    server = broker.ThreadingUnixServer(str(path), broker.BrokerRequestHandler)
    server.application = application
    server.shared_secret = secret.encode()
    path.chmod(0o660)
    application.start_relays()
    try:
        server.serve_forever()
    finally:
        application.stop_event.set()
        server.server_close()
        path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("bridge", "worker"))
    parser.add_argument("--config")
    parser.add_argument("--socket")
    parser.add_argument("--runtime")
    parser.add_argument("--repo")
    parser.add_argument("--heartbeat")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    if args.mode == "worker":
        run_worker(args)
    else:
        run_bridge(args)


if __name__ == "__main__":
    main()
