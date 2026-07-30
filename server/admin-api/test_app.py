import os
import unittest
import uuid
from types import SimpleNamespace

from fastapi.testclient import TestClient
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

os.environ.setdefault(
    "ADMIN_CF_TEAM_DOMAIN", "https://example.cloudflareaccess.com"
)
os.environ.setdefault("ADMIN_CF_POLICY_AUD", "test-audience")
os.environ.setdefault("ADMIN_ALLOWED_EMAIL", "admin@example.com")
os.environ.setdefault("ADMIN_CSRF_SECRET", "c" * 32)
os.environ.setdefault("ADMIN_BROKER_SHARED_SECRET", "b" * 32)

from app import AccessAuthenticator, Settings, create_app


class FakeBroker:
    def __init__(self):
        self.calls = []

    def call(self, method, actor, params=None):
        self.calls.append((method, actor, params or {}))
        if method == "services.list":
            return []
        if method == "timecard.active":
            return []
        if method == "services.action":
            return {
                "requestId": params["requestId"],
                "status": "succeeded",
            }
        if method == "timecard.records":
            return {
                "month": params["month"],
                "items": [],
                "total": 0,
                "page": 1,
                "pageSize": 100,
            }
        if method == "audit.list":
            return []
        return {}


def settings(tmp_dir, *, allowed_email="admin@example.com"):
    return Settings(
        team_domain="https://example.cloudflareaccess.com",
        policy_audience="audience",
        allowed_email=allowed_email,
        admin_origin="https://mu-natuki.com",
        csrf_secret="c" * 32,
        broker_secret="b" * 32,
        broker_socket="/unused",
        public_status_dir=tmp_dir,
        app_env="test",
        test_auth_email="admin@example.com",
    )


class AdminApiTests(unittest.TestCase):
    def setUp(self):
        self.broker = FakeBroker()
        self.app = create_app(settings("/tmp"), self.broker)
        self.client = TestClient(self.app)

    def test_session_and_read_routes_are_no_store(self):
        response = self.client.get("/api/admin/v1/session")
        self.assertEqual(response.status_code, 200)
        self.assertIn("csrfToken", response.json())
        self.assertEqual(response.headers["cache-control"], "no-store, max-age=0")

        response = self.client.get("/api/admin/v1/services")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"items": []})

    def test_write_requires_origin_and_csrf(self):
        session = self.client.get("/api/admin/v1/session").json()
        request_id = str(uuid.uuid4())
        missing = self.client.post(
            "/api/admin/v1/services/youtube/actions",
            json={"action": "restart", "requestId": request_id},
        )
        self.assertEqual(missing.status_code, 403)

        response = self.client.post(
            "/api/admin/v1/services/youtube/actions",
            headers={
                "Origin": "https://mu-natuki.com",
                "Sec-Fetch-Site": "same-origin",
                "X-CSRF-Token": session["csrfToken"],
            },
            json={"action": "restart", "requestId": request_id},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "succeeded")

    def test_wrong_administrator_email_is_denied(self):
        app = create_app(
            settings("/tmp", allowed_email="other@example.com"), self.broker
        )
        response = TestClient(app).get("/api/admin/v1/session")
        self.assertEqual(response.status_code, 403)


class AccessAuthenticatorTests(unittest.TestCase):
    def setUp(self):
        self.settings = Settings(
            team_domain="https://example.cloudflareaccess.com",
            policy_audience="expected-audience",
            allowed_email="admin@example.com",
            admin_origin="https://mu-natuki.com",
            csrf_secret="c" * 32,
            broker_secret="b" * 32,
            broker_socket="/unused",
            public_status_dir="/tmp",
        )
        self.private_key = rsa.generate_private_key(
            public_exponent=65537, key_size=2048
        )
        self.authenticator = AccessAuthenticator(self.settings)
        self.authenticator.jwk_client = SimpleNamespace(
            get_signing_key_from_jwt=lambda _token: SimpleNamespace(
                key=self.private_key.public_key()
            )
        )

    def token(self, **overrides):
        now = int(__import__("time").time())
        payload = {
            "iss": self.settings.team_domain,
            "aud": [self.settings.policy_audience],
            "iat": now,
            "exp": now + 300,
            "email": "admin@example.com",
            **overrides,
        }
        return jwt.encode(payload, self.private_key, algorithm="RS256")

    def test_valid_access_token_is_accepted(self):
        self.assertEqual(
            self.authenticator.authenticate(self.token()),
            "admin@example.com",
        )

    def test_wrong_audience_and_email_are_rejected(self):
        with self.assertRaises(Exception):
            self.authenticator.authenticate(self.token(aud=["other"]))
        with self.assertRaises(Exception):
            self.authenticator.authenticate(
                self.token(email="someone@example.com")
            )


if __name__ == "__main__":
    unittest.main()
