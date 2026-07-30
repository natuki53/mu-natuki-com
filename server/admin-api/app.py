from __future__ import annotations

import base64
import csv
import datetime as dt
import hashlib
import hmac
import io
import json
import os
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from jwt import PyJWKClient
from pydantic import BaseModel, Field


@dataclass(frozen=True)
class Settings:
    team_domain: str
    policy_audience: str
    allowed_email: str
    admin_origin: str
    csrf_secret: str
    broker_secret: str
    broker_socket: str
    public_status_dir: str
    app_env: str = "production"
    test_auth_email: str | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            team_domain=os.environ["ADMIN_CF_TEAM_DOMAIN"].rstrip("/"),
            policy_audience=os.environ["ADMIN_CF_POLICY_AUD"],
            allowed_email=os.environ["ADMIN_ALLOWED_EMAIL"].strip().casefold(),
            admin_origin=os.getenv(
                "ADMIN_ORIGIN", "https://mu-natuki.com"
            ).rstrip("/"),
            csrf_secret=os.environ["ADMIN_CSRF_SECRET"],
            broker_secret=os.environ["ADMIN_BROKER_SHARED_SECRET"],
            broker_socket=os.getenv(
                "ADMIN_BROKER_SOCKET", "/run/admin-broker/control.sock"
            ),
            public_status_dir=os.getenv(
                "ADMIN_PUBLIC_STATUS_DIR", "/public-status"
            ),
            app_env=os.getenv("APP_ENV", "production"),
            test_auth_email=os.getenv("ADMIN_TEST_AUTH_EMAIL"),
        )


class BrokerFailure(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def canonical_json(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")


class BrokerClient:
    def __init__(self, socket_path: str, shared_secret: str):
        self.socket_path = socket_path
        self.shared_secret = shared_secret.encode("utf-8")

    def call(self, method: str, actor: str, params: dict | None = None):
        payload = {"method": method, "actor": actor, "params": params or {}}
        envelope = {
            "payload": payload,
            "signature": hmac.new(
                self.shared_secret, canonical_json(payload), hashlib.sha256
            ).hexdigest(),
        }
        request_bytes = canonical_json(envelope) + b"\n"
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                connection.settimeout(70)
                connection.connect(self.socket_path)
                connection.sendall(request_bytes)
                chunks = []
                total = 0
                while True:
                    chunk = connection.recv(65536)
                    if not chunk:
                        break
                    chunks.append(chunk)
                    total += len(chunk)
                    if total > 1024 * 1024:
                        raise BrokerFailure(502, "broker response is too large")
                    if b"\n" in chunk:
                        break
        except (OSError, TimeoutError) as exc:
            raise BrokerFailure(503, "administration broker is unavailable") from exc
        try:
            response = json.loads(b"".join(chunks).split(b"\n", 1)[0])
        except (json.JSONDecodeError, IndexError) as exc:
            raise BrokerFailure(502, "invalid response from administration broker") from exc
        if not response.get("ok"):
            error = response.get("error") or {}
            raise BrokerFailure(
                int(error.get("status", 502)),
                str(error.get("message") or "administration request failed"),
            )
        return response.get("result")


class AccessAuthenticator:
    def __init__(self, settings: Settings):
        self.settings = settings
        certs_url = (
            f"{settings.team_domain}/cdn-cgi/access/certs"
        )
        self.jwk_client = PyJWKClient(
            certs_url, cache_keys=True, lifespan=3600
        )

    def authenticate(self, token: str | None) -> str:
        if (
            self.settings.app_env == "test"
            and self.settings.test_auth_email
        ):
            email = self.settings.test_auth_email.casefold()
        else:
            if not token:
                raise HTTPException(403, "Cloudflare Access token is required")
            try:
                signing_key = self.jwk_client.get_signing_key_from_jwt(token)
                payload = jwt.decode(
                    token,
                    signing_key.key,
                    algorithms=["RS256"],
                    audience=self.settings.policy_audience,
                    issuer=self.settings.team_domain,
                    options={"require": ["exp", "iat", "iss", "aud", "email"]},
                )
            except jwt.PyJWTError as exc:
                raise HTTPException(403, "Cloudflare Access token is invalid") from exc
            email = str(payload.get("email") or "").strip().casefold()
        if not hmac.compare_digest(email, self.settings.allowed_email):
            raise HTTPException(403, "administrator email is not allowed")
        return email


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


class CsrfTokens:
    def __init__(self, secret: str):
        if len(secret) < 32:
            raise RuntimeError("ADMIN_CSRF_SECRET must contain at least 32 characters")
        self.secret = secret.encode("utf-8")

    def issue(self, email: str) -> str:
        payload = {
            "email": email,
            "exp": int((dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=30)).timestamp()),
            "nonce": _b64url(os.urandom(18)),
        }
        encoded = _b64url(canonical_json(payload))
        signature = hmac.new(
            self.secret, encoded.encode("ascii"), hashlib.sha256
        ).hexdigest()
        return f"{encoded}.{signature}"

    def verify(self, token: str | None, email: str) -> None:
        if not token or "." not in token:
            raise HTTPException(403, "CSRF token is required")
        encoded, supplied = token.rsplit(".", 1)
        expected = hmac.new(
            self.secret, encoded.encode("ascii"), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(supplied, expected):
            raise HTTPException(403, "CSRF token is invalid")
        try:
            payload = json.loads(_b64url_decode(encoded))
        except (ValueError, json.JSONDecodeError) as exc:
            raise HTTPException(403, "CSRF token is invalid") from exc
        now = int(dt.datetime.now(dt.timezone.utc).timestamp())
        if int(payload.get("exp", 0)) < now:
            raise HTTPException(403, "CSRF token expired")
        if not hmac.compare_digest(str(payload.get("email", "")), email):
            raise HTTPException(403, "CSRF identity mismatch")


class ServiceAction(BaseModel):
    action: str
    requestId: str


class AttendanceCorrection(BaseModel):
    startAt: str
    endAt: str
    breakSeconds: int = Field(ge=0)
    reason: str = Field(min_length=3, max_length=500)
    recordVersion: str = Field(min_length=64, max_length=64)
    requestId: str


def create_app(
    settings: Settings | None = None,
    broker: BrokerClient | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    if len(settings.broker_secret) < 32:
        raise RuntimeError(
            "ADMIN_BROKER_SHARED_SECRET must contain at least 32 characters"
        )
    broker = broker or BrokerClient(
        settings.broker_socket, settings.broker_secret
    )
    authenticator = AccessAuthenticator(settings)
    csrf_tokens = CsrfTokens(settings.csrf_secret)
    app = FastAPI(
        title="mu-natuki Administration API",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Cloudflare-CDN-Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    def current_user(
        cf_access_jwt_assertion: str | None = Header(
            None, alias="Cf-Access-Jwt-Assertion"
        ),
    ) -> str:
        return authenticator.authenticate(cf_access_jwt_assertion)

    def require_write_access(
        request: Request,
        user: str = Depends(current_user),
        x_csrf_token: str | None = Header(None, alias="X-CSRF-Token"),
    ) -> str:
        origin = request.headers.get("origin")
        if origin != settings.admin_origin:
            raise HTTPException(403, "request origin is not allowed")
        fetch_site = request.headers.get("sec-fetch-site")
        if fetch_site and fetch_site not in {"same-origin", "none"}:
            raise HTTPException(403, "cross-site request is not allowed")
        csrf_tokens.verify(x_csrf_token, user)
        return user

    def broker_call(method: str, user: str, params: dict | None = None):
        try:
            return broker.call(method, user, params)
        except BrokerFailure as exc:
            raise HTTPException(exc.status, exc.message) from exc

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"status": exc.status_code, "message": exc.detail}},
        )

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    @app.get("/api/admin/v1/session")
    def session(user: str = Depends(current_user)):
        return {
            "email": user,
            "csrfToken": csrf_tokens.issue(user),
            "expiresInSeconds": 1800,
        }

    @app.get("/api/admin/v1/overview")
    def overview(user: str = Depends(current_user)):
        services = broker_call("services.list", user)
        active = broker_call("timecard.active", user)
        snapshots = {}
        for filename in (
            "server-status.json",
            "bot-status.json",
            "web-app-status.json",
        ):
            path = Path(settings.public_status_dir) / filename
            try:
                snapshots[filename.removesuffix(".json")] = json.loads(
                    path.read_text(encoding="utf-8")
                )
            except (OSError, json.JSONDecodeError):
                snapshots[filename.removesuffix(".json")] = None
        return {
            "measuredAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "services": services,
            "activeAttendanceCount": len(active),
            "publicStatus": snapshots,
        }

    @app.get("/api/admin/v1/services")
    def services(user: str = Depends(current_user)):
        return {"items": broker_call("services.list", user)}

    @app.post("/api/admin/v1/services/{service_id}/actions")
    def service_action(
        service_id: str,
        body: ServiceAction,
        user: str = Depends(require_write_access),
    ):
        return broker_call(
            "services.action",
            user,
            {
                "id": service_id,
                "action": body.action,
                "requestId": body.requestId,
            },
        )

    @app.get("/api/admin/v1/timecard/members")
    def timecard_members(user: str = Depends(current_user)):
        return {"items": broker_call("timecard.members", user)}

    @app.get("/api/admin/v1/timecard/active")
    def timecard_active(user: str = Depends(current_user)):
        return {"items": broker_call("timecard.active", user)}

    @app.get("/api/admin/v1/timecard/summary")
    def timecard_summary(
        month: str,
        memberId: str | None = None,
        user: str = Depends(current_user),
    ):
        return broker_call(
            "timecard.summary",
            user,
            {"month": month, "memberId": memberId},
        )

    @app.get("/api/admin/v1/timecard/records")
    def timecard_records(
        month: str,
        memberId: str | None = None,
        page: Annotated[int, Query(ge=1)] = 1,
        pageSize: Annotated[int, Query(ge=1, le=100)] = 50,
        user: str = Depends(current_user),
    ):
        return broker_call(
            "timecard.records",
            user,
            {
                "month": month,
                "memberId": memberId,
                "page": page,
                "pageSize": pageSize,
            },
        )

    @app.get("/api/admin/v1/timecard/export.csv")
    def timecard_export(
        month: str,
        memberId: str | None = None,
        user: str = Depends(current_user),
    ):
        data = broker_call(
            "timecard.records",
            user,
            {
                "month": month,
                "memberId": memberId,
                "page": 1,
                "pageSize": 100,
            },
        )
        items = list(data["items"])
        page = 2
        while len(items) < data["total"]:
            if page > 50:
                raise HTTPException(413, "CSV export exceeds 5,000 records")
            next_page = broker_call(
                "timecard.records",
                user,
                {
                    "month": month,
                    "memberId": memberId,
                    "page": page,
                    "pageSize": 100,
                },
            )
            if not next_page["items"]:
                break
            items.extend(next_page["items"])
            page += 1
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "メンバー",
                "Discord ID",
                "出勤",
                "退勤",
                "休憩秒",
                "勤務秒",
            ]
        )
        for item in items:
            writer.writerow(
                [
                    item["displayName"],
                    item["memberId"],
                    item["startAt"],
                    item["endAt"],
                    item["breakSeconds"],
                    item["workSeconds"],
                ]
            )
        body = b"\xef\xbb\xbf" + output.getvalue().encode("utf-8")
        return Response(
            body,
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="timecard-{month}.csv"'
            },
        )

    @app.patch("/api/admin/v1/timecard/records/{month}/{record_id}")
    def timecard_correct(
        month: str,
        record_id: int,
        body: AttendanceCorrection,
        user: str = Depends(require_write_access),
    ):
        return broker_call(
            "timecard.correct",
            user,
            {
                "month": month,
                "recordId": record_id,
                **body.model_dump(),
            },
        )

    @app.get("/api/admin/v1/audit")
    def audit(
        limit: Annotated[int, Query(ge=1, le=100)] = 100,
        user: str = Depends(current_user),
    ):
        return {"items": broker_call("audit.list", user, {"limit": limit})}

    return app


app = create_app()
