"""GET /push/config and GET /ai/status, and the settings behind them (the config parts of
server/src/tests/native.test.ts, phase3.test.ts and phase4.test.ts; their other tests arrive in Phases 4 and 5).
"""

from collections.abc import Iterator
from datetime import UTC, datetime

import httpx
import pytest
from bson import ObjectId

from server_py.config.ai import AI_DAILY_LIMIT
from server_py.config.env import DEFAULT_AI_MODEL, AnthropicConfig, FcmConfig, VapidConfig, env
from server_py.config.features import set_photo_check_enabled
from server_py.models.ai_usage import AI_USAGE
from server_py.services import clock
from server_py.services.ai_client import ai_client, set_ai_client
from server_py.services.push_provider import set_native_push_provider, set_push_provider
from tests.conftest import register_user, set_today

pytestmark = pytest.mark.phase1


@pytest.fixture(autouse=True)
def providers_off() -> Iterator[None]:
    yield
    set_push_provider(None)
    set_native_push_provider(None)
    set_ai_client(None)
    set_photo_check_enabled(None)


class TestPushConfig:
    async def test_reports_no_public_key_when_push_isnt_set_up(self, api: httpx.AsyncClient) -> None:
        s = await register_user(api)
        res = await api.get("/api/push/config", headers=s.headers)
        assert res.status_code == 200
        assert res.json() == {"publicKey": None, "native": False}

    async def test_exposes_only_the_vapid_public_key_never_the_private_key(self, api: httpx.AsyncClient) -> None:
        set_push_provider(VapidConfig("PUBLIC-KEY", "PRIVATE-KEY", "mailto:a@example.com"))
        s = await register_user(api)
        res = await api.get("/api/push/config", headers=s.headers)
        assert res.json() == {"publicKey": "PUBLIC-KEY", "native": False}
        assert "PRIVATE" not in res.text

    async def test_says_whether_push_to_the_apps_is_set_up(self, api: httpx.AsyncClient) -> None:
        s = await register_user(api)
        set_native_push_provider(FcmConfig("project", "a@example.com", "KEY"))
        assert (await api.get("/api/push/config", headers=s.headers)).json() == {"publicKey": None, "native": True}
        set_push_provider(VapidConfig("PUBLIC-KEY", "PRIVATE-KEY", "mailto:a@example.com"))
        assert (await api.get("/api/push/config", headers=s.headers)).json() == {
            "publicKey": "PUBLIC-KEY",
            "native": True,
        }

    async def test_needs_a_login(self, api: httpx.AsyncClient) -> None:
        assert (await api.get("/api/push/config")).status_code == 401


class TestAiStatus:
    def test_tests_never_see_the_real_key(self) -> None:
        assert env.ai is None
        assert ai_client() is None

    def test_uses_claude_sonnet_5_5_unless_ai_model_says_otherwise(self) -> None:
        assert DEFAULT_AI_MODEL == "claude-sonnet-5-5"

    async def test_reports_ai_as_off_when_no_key_is_set(self, api: httpx.AsyncClient) -> None:
        s = await register_user(api)
        res = await api.get("/api/ai/status", headers=s.headers)
        assert res.json() == {"enabled": False, "photoCheck": False, "dailyLimit": AI_DAILY_LIMIT, "usedToday": 0}

    async def test_photo_check_needs_both_ai_and_its_flag(self, api: httpx.AsyncClient) -> None:
        s = await register_user(api)
        set_photo_check_enabled(True)
        assert (await api.get("/api/ai/status", headers=s.headers)).json()["photoCheck"] is False
        set_ai_client(AnthropicConfig("key", DEFAULT_AI_MODEL))
        assert (await api.get("/api/ai/status", headers=s.headers)).json() == {
            "enabled": True,
            "photoCheck": True,
            "dailyLimit": AI_DAILY_LIMIT,
            "usedToday": 0,
        }

    async def test_counts_todays_requests_in_the_users_time_zone(self, api: httpx.AsyncClient) -> None:
        s = await register_user(api, timeZone="Asia/Kolkata")
        set_today("2026-09-29")
        user_id = ObjectId(s.user["id"])
        await AI_USAGE.collection().insert_many(
            [
                {"userId": user_id, "date": "2026-09-29", "count": 7},
                {"userId": user_id, "date": "2026-09-28", "count": 20},
            ]
        )
        assert (await api.get("/api/ai/status", headers=s.headers)).json()["usedToday"] == 7
        # 20:00 UTC is already the next day in India.
        clock.set(datetime(2026, 9, 29, 20, tzinfo=UTC))
        assert (await api.get("/api/ai/status", headers=s.headers)).json()["usedToday"] == 0
