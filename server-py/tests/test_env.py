"""Settings read from the environment (server/src/config/env.ts) and the time zones Intl accepts."""

import re

import pytest

from server_py.config.env import (
    DEFAULT_GEMINI_MODEL_FAST,
    DEFAULT_GEMINI_MODEL_SMART,
    DEV_JWT_SECRET,
    AnthropicConfig,
    FcmConfig,
    GeminiConfig,
    VapidConfig,
    ai_provider_from,
    ai_startup_warnings,
    jobs_enabled_from,
    load_env,
)
from server_py.services.time_zone import is_valid_time_zone
from server_py.shared.dates import today_in_tz

pytestmark = pytest.mark.phase1


def test_development_defaults() -> None:
    env = load_env({})
    assert (env.is_production, env.is_test, env.port, env.mongo_uri) == (False, False, 4000, "")
    assert (env.jwt_secret, env.jwt_expires_in) == (DEV_JWT_SECRET, "7d")
    assert env.client_origins == ("http://localhost:5173",)
    assert (env.vapid, env.ai, env.fcm, env.apns_bundle_id) == (None, None, None, None)
    assert (env.public_api_url, env.photo_check, env.jobs_enabled) == ("", False, True)
    assert env.product_lookup_url == "https://world.openfoodfacts.org"


def test_production_needs_a_jwt_secret() -> None:
    with pytest.raises(ValueError, match=re.escape("JWT_SECRET must be set in production.")):
        load_env({"NODE_ENV": "production"})
    assert load_env({"NODE_ENV": "production", "JWT_SECRET": "s"}).jwt_secret == "s"


def test_values_are_read_as_env_ts_reads_them() -> None:
    env = load_env(
        {
            "PORT": "5000",
            "CLIENT_ORIGIN": " https://a.example , ,https://b.example",
            "PUBLIC_API_URL": "https://api.example.com/api//",
            "PHOTO_CHECK": "on",
            "APNS_BUNDLE_ID": "",
            "PRODUCT_LOOKUP_URL": "",
            "FIREBASE_PROJECT_ID": "p",
            "FIREBASE_CLIENT_EMAIL": "e",
            "FIREBASE_PRIVATE_KEY": "line1\\nline2",
            "VAPID_PUBLIC_KEY": "pub",
            "VAPID_PRIVATE_KEY": "priv",
        }
    )
    assert env.port == 5000
    assert env.client_origins == ("https://a.example", "https://b.example")
    assert env.public_api_url == "https://api.example.com/api"
    assert env.photo_check is True
    assert env.apns_bundle_id is None
    assert env.product_lookup_url == "https://world.openfoodfacts.org"
    assert env.fcm == FcmConfig("p", "e", "line1\nline2")
    # Web Push needs all three values.
    assert env.vapid is None
    assert load_env({"VAPID_PUBLIC_KEY": "a", "VAPID_PRIVATE_KEY": "b", "VAPID_SUBJECT": "c"}).vapid == VapidConfig(
        "a", "b", "c"
    )
    assert load_env({"PHOTO_CHECK": "ON"}).photo_check is False


def test_ai_provider_choice() -> None:
    assert ai_provider_from(None, production=False) == "gemini"
    assert ai_provider_from("", production=True) == "anthropic"
    assert ai_provider_from(" Gemini ", production=True) == "gemini"
    with pytest.raises(ValueError, match=re.escape('AI_PROVIDER must be "anthropic" or "gemini" (got "openai").')):
        ai_provider_from("openai", production=False)
    assert load_env({"GEMINI_API_KEY": "k"}).ai == GeminiConfig(
        "k", DEFAULT_GEMINI_MODEL_FAST, DEFAULT_GEMINI_MODEL_SMART, "free"
    )
    assert load_env({"GEMINI_API_KEY": "k", "GEMINI_TIER": " PAID "}).ai == GeminiConfig(
        "k", DEFAULT_GEMINI_MODEL_FAST, DEFAULT_GEMINI_MODEL_SMART, "paid"
    )
    assert load_env({"AI_PROVIDER": "anthropic", "ANTHROPIC_API_KEY": "k", "AI_MODEL": "m"}).ai == AnthropicConfig(
        "k", "m"
    )
    # The chosen provider's key, and only that one, turns AI on; tests never read a key.
    assert load_env({"AI_PROVIDER": "anthropic", "GEMINI_API_KEY": "k"}).ai is None
    assert load_env({"NODE_ENV": "test", "GEMINI_API_KEY": "k"}).ai is None


def test_a_free_gemini_key_in_production_is_warned_about() -> None:
    free = GeminiConfig("k", "f", "s", "free")
    assert ai_startup_warnings(free, production=True) == [
        "AI_PROVIDER=gemini is using a free-tier key in production. Google may use free-tier prompts, including "
        "photos, to improve its products. Use a paid key and set GEMINI_TIER=paid, or set AI_PROVIDER=anthropic."
    ]
    assert ai_startup_warnings(free, production=False) == []
    assert ai_startup_warnings(GeminiConfig("k", "f", "s", "paid"), production=True) == []
    assert ai_startup_warnings(None, production=True) == []


def test_jobs_enabled() -> None:
    for on in [None, "", "true", "1", "on", "yes", " TRUE "]:
        assert jobs_enabled_from(on) is True
    for off in ["false", "0", "off", "no", "No"]:
        assert jobs_enabled_from(off) is False
    with pytest.raises(ValueError, match=re.escape('JOBS_ENABLED must be "true" or "false" (got "maybe").')):
        jobs_enabled_from("maybe")


# Recorded from Node 24's Intl.DateTimeFormat: the zones it accepts, and the ones it refuses.
ACCEPTED = [
    "UTC", "utc", "Etc/UTC", "GMT", "asia/kolkata", "Asia/Kolkata", "US/Eastern", "EST", "EST5EDT", "Etc/GMT+5",
    "+05:30", "-08:00", "+0530", "+05", "Europe/Kyiv", "Europe/Kiev", "Asia/Calcutta", "ROC", "GMT0", "UCT",
    "Universal", "Zulu", "America/Argentina/Buenos_Aires", "america/argentina/buenos_aires", "+00:00", "-00:00",
    "+23:59", chr(0x2212) + "05:00", "CET", "WET",
]  # fmt: skip
REFUSED = [
    "Z", "Mars/Olympus", "", "  UTC", "UTC ", "Factory", "localtime", "Etc/Unknown", "+24:00", "+12:60", "+1:00",
    "+05:30:00", "+053", "+5", "posixrules", "posix/Europe/London", "right/UTC", "zone.tab", "tzdata.zi",
]  # fmt: skip


@pytest.mark.parametrize("zone", ACCEPTED)
def test_time_zones_node_accepts(zone: str) -> None:
    assert is_valid_time_zone(zone)
    today_in_tz(zone)


@pytest.mark.parametrize("zone", REFUSED)
def test_time_zones_node_refuses(zone: str) -> None:
    assert not is_valid_time_zone(zone)


def test_an_offset_zone_gives_its_own_today() -> None:
    from datetime import UTC, datetime

    late = datetime(2026, 9, 29, 20, tzinfo=UTC)
    assert today_in_tz("+05:30", late) == "2026-09-30"
    assert today_in_tz("-08:00", datetime(2026, 9, 30, 3, tzinfo=UTC)) == "2026-09-29"
