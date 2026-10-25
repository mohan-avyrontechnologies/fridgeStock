"""Registration, login and protected endpoints (server/src/tests/auth.test.ts, all 13 tests)."""

import re

import httpx
import pytest

from server_py.config.env import env
from server_py.models.user import USER
from server_py.services import token
from tests.conftest import register_user

pytestmark = pytest.mark.phase1


def _sign(payload: dict[str, object], secret: str) -> str:
    """jwt.sign with another payload or secret, for the tampered and expired cases."""
    original = env.jwt_secret
    object.__setattr__(env, "jwt_secret", secret)
    try:
        return token._sign(payload)  # pyright: ignore[reportPrivateUsage]
    finally:
        object.__setattr__(env, "jwt_secret", original)


class TestRegistration:
    async def test_creates_an_account_and_returns_a_token_and_user(self, api: httpx.AsyncClient) -> None:
        body = {"name": "Asha", "email": "Asha@Example.com", "password": "longenough", "timeZone": "Asia/Kolkata"}
        res = await api.post("/api/auth/register", json=body)
        assert res.status_code == 201
        assert isinstance(res.json()["token"], str)
        user = res.json()["user"]
        assert user["name"] == "Asha"
        assert user["email"] == "asha@example.com"
        assert user["timeZone"] == "Asia/Kolkata"
        assert user["notificationPreferences"] == {"approachingExpiry": True, "due": True, "overdue": True}
        assert "passwordHash" not in user

    async def test_stores_a_bcrypt_hash_never_the_plaintext_password(self, api: httpx.AsyncClient) -> None:
        await register_user(api, email="hash@example.com", password="plaintext-password")
        user = await USER.collection().find_one({"email": "hash@example.com"})
        assert user is not None
        assert "plaintext-password" not in user["passwordHash"]
        assert re.match(r"^\$2[aby]\$12\$", user["passwordHash"])

    async def test_rejects_a_duplicate_email_with_409(self, api: httpx.AsyncClient) -> None:
        await register_user(api, email="dup@example.com")
        res = await api.post(
            "/api/auth/register", json={"name": "Again", "email": "DUP@example.com", "password": "longenough"}
        )
        assert res.status_code == 409
        assert res.json()["error"]["code"] == "CONFLICT"
        assert res.json()["error"]["field"] == "email"
        assert await USER.collection().count_documents({"email": "dup@example.com"}) == 1

    async def test_limits_names_to_50_characters_and_stores_email_in_lowercase(self, api: httpx.AsyncClient) -> None:
        long = await api.post(
            "/api/auth/register", json={"name": "n" * 51, "email": "long@example.com", "password": "longenough"}
        )
        assert long.status_code == 400
        assert long.json()["error"]["field"] == "name"
        assert long.json()["error"]["message"] == "Name must be at most 50 characters."
        ok = await api.post(
            "/api/auth/register", json={"name": "n" * 50, "email": "MiXeD@Example.COM", "password": "longenough"}
        )
        assert ok.status_code == 201
        assert ok.json()["user"]["email"] == "mixed@example.com"

    async def test_defaults_the_time_zone_to_utc_and_turns_on_all_three_reminder_types(
        self, api: httpx.AsyncClient
    ) -> None:
        res = await api.post(
            "/api/auth/register", json={"name": "Default", "email": "defaults@example.com", "password": "longenough"}
        )
        assert res.status_code == 201
        assert res.json()["user"]["timeZone"] == "UTC"
        assert res.json()["user"]["notificationPreferences"] == {
            "approachingExpiry": True,
            "due": True,
            "overdue": True,
        }

    async def test_rejects_short_passwords_and_bad_emails(self, api: httpx.AsyncClient) -> None:
        short = await api.post("/api/auth/register", json={"name": "A", "email": "a@example.com", "password": "short"})
        assert short.status_code == 400
        assert short.json()["error"]["field"] == "password"
        email = await api.post(
            "/api/auth/register", json={"name": "A", "email": "not-an-email", "password": "longenough"}
        )
        assert email.status_code == 400
        assert email.json()["error"]["field"] == "email"

    async def test_falls_back_to_utc_for_an_unknown_time_zone(self, api: httpx.AsyncClient) -> None:
        account = await register_user(api, timeZone="Mars/Olympus")
        assert account.user["timeZone"] == "UTC"


class TestLogin:
    async def test_logs_in_with_valid_credentials(self, api: httpx.AsyncClient) -> None:
        account = await register_user(api)
        res = await api.post("/api/auth/login", json={"email": account.user["email"], "password": account.password})
        assert res.status_code == 200
        assert isinstance(res.json()["token"], str)
        assert res.json()["user"]["id"] == account.user["id"]

    async def test_gives_the_same_401_for_a_wrong_password_and_an_unknown_email(self, api: httpx.AsyncClient) -> None:
        account = await register_user(api)
        wrong = await api.post("/api/auth/login", json={"email": account.user["email"], "password": "nope-nope"})
        unknown = await api.post("/api/auth/login", json={"email": "ghost@example.com", "password": "nope-nope"})
        assert wrong.status_code == 401
        assert unknown.status_code == 401
        assert wrong.json() == unknown.json()

    async def test_updates_the_stored_time_zone_to_where_the_user_signs_in(self, api: httpx.AsyncClient) -> None:
        account = await register_user(api, timeZone="UTC")
        res = await api.post(
            "/api/auth/login",
            json={"email": account.user["email"], "password": account.password, "timeZone": "Europe/London"},
        )
        assert res.status_code == 200
        assert res.json()["user"]["timeZone"] == "Europe/London"


class TestProtectedEndpoints:
    async def test_reject_missing_malformed_tampered_and_expired_tokens(self, api: httpx.AsyncClient) -> None:
        account = await register_user(api)
        expired = _sign({"iat": 1, "exp": 2, "sub": account.user["id"]}, env.jwt_secret)
        forged = _sign({"iat": 1, "sub": account.user["id"]}, "some-other-secret")
        for header in [None, "Bearer", "Bearer garbage", f"Bearer {expired}", f"Bearer {forged}", "Basic abc"]:
            res = await api.get("/api/foods", headers={"Authorization": header} if header else {})
            assert res.status_code == 401, header
            assert res.json()["error"]["code"] == "UNAUTHENTICATED"

    async def test_rejects_a_valid_token_for_a_deleted_user(self, api: httpx.AsyncClient) -> None:
        account = await register_user(api)
        await USER.collection().delete_one({"email": account.user["email"]})
        assert (await api.get("/api/foods", headers=account.headers)).status_code == 401

    async def test_returns_the_current_user_from_auth_me(self, api: httpx.AsyncClient) -> None:
        account = await register_user(api)
        res = await api.get("/api/auth/me", headers=account.headers)
        assert res.status_code == 200
        assert res.json()["user"]["id"] == account.user["id"]


class TestNameLength:
    """The request schema counts code points (an emoji is 1); the model's maxlength counts UTF-16 units (an emoji
    is 2), so a name can pass the first and fail the second. Messages recorded from the Node server."""

    EMOJI = chr(0x1F600)

    async def test_the_models_limit_applies_after_the_schemas(self, api: httpx.AsyncClient) -> None:
        ok = await api.post(
            "/api/auth/register", json={"name": self.EMOJI * 25, "email": "e25@b.co", "password": "longenough"}
        )
        assert ok.status_code == 201
        too_long = await api.post(
            "/api/auth/register", json={"name": self.EMOJI * 26, "email": "e26@b.co", "password": "longenough"}
        )
        assert too_long.status_code == 400
        assert too_long.json() == {
            "error": {
                "code": "VALIDATION_ERROR",
                "message": f"Path `name` (`{self.EMOJI * 15}...`, length 52) is longer than the maximum allowed "
                "length (50).",
                "field": "name",
            }
        }
        assert await USER.collection().count_documents({"email": "e26@b.co"}) == 0

    async def test_the_message_cuts_the_value_at_30_units(self, api: httpx.AsyncClient) -> None:
        res = await api.post(
            "/api/auth/register", json={"name": "a" * 49 + self.EMOJI, "email": "x@b.co", "password": "longenough"}
        )
        assert res.json()["error"]["message"] == (
            f"Path `name` (`{'a' * 30}...`, length 51) is longer than the maximum allowed length (50)."
        )

    async def test_renaming_is_checked_too(self, api: httpx.AsyncClient) -> None:
        account = await register_user(api)
        res = await api.put("/api/auth/me", headers=account.headers, json={"name": self.EMOJI * 26})
        assert res.status_code == 400
        assert res.json()["error"]["field"] == "name"
        assert (await api.get("/api/auth/me", headers=account.headers)).json()["user"]["name"] == account.user["name"]
