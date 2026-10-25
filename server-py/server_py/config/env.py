"""Everything the server reads from its environment (server/src/config/env.py). Secrets come only from here.

Values are read once, when this module is first imported, from the process environment and from
server-py/.env (which never overrides a variable that is already set, as dotenv does in the TypeScript server).
`load_env` builds the same settings from any mapping, so tests can check them without touching the process.
"""

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal

from dotenv import load_dotenv

from server_py.shared.js import trim

SERVER_PY: Final = Path(__file__).resolve().parents[2]

DEV_JWT_SECRET: Final = "dev-only-secret-do-not-use-in-production"

AiProvider = Literal["anthropic", "gemini"]

# Gemini models for the two tiers. Override with GEMINI_MODEL_FAST / GEMINI_MODEL_SMART.
DEFAULT_GEMINI_MODEL_FAST: Final = "gemini-2.5-flash"
DEFAULT_GEMINI_MODEL_SMART: Final = "gemini-2.5-pro"

# Claude Sonnet 5.5; ID checked against Anthropic's models overview on 2026-09-30.
DEFAULT_AI_MODEL: Final = "claude-sonnet-5-5"


@dataclass(frozen=True)
class AnthropicConfig:
    api_key: str
    model: str
    provider: Literal["anthropic"] = "anthropic"


@dataclass(frozen=True)
class GeminiConfig:
    api_key: str
    fast_model: str
    smart_model: str
    tier: Literal["free", "paid"]
    provider: Literal["gemini"] = "gemini"


AiConfig = AnthropicConfig | GeminiConfig
"""What a provider needs to make requests. None (see `_ai`) means AI features are off."""


@dataclass(frozen=True)
class VapidConfig:
    """Web Push keys. Only the public key is ever sent to the client."""

    public_key: str
    private_key: str
    subject: str


@dataclass(frozen=True)
class FcmConfig:
    """Firebase Cloud Messaging, for push to the Android and iOS apps."""

    project_id: str
    client_email: str
    private_key: str


@dataclass(frozen=True)
class Env:
    is_production: bool
    is_test: bool
    port: int
    # Empty in development means "use the embedded MongoDB".
    mongo_uri: str
    jwt_secret: str
    jwt_expires_in: str
    # Browser origin(s) allowed by CORS; comma-separated for more than one.
    client_origins: tuple[str, ...]
    # None when push isn't configured.
    vapid: VapidConfig | None
    # None when AI features are off.
    ai: AiConfig | None
    # None when push to the apps isn't configured.
    fcm: FcmConfig | None
    # The iOS app's bundle id, sent as the APNs topic (optional).
    apns_bundle_id: str | None
    # Where this API is reached from outside, like https://api.example.com/api, so notification buttons in the
    # apps can call it.
    public_api_url: str
    # Photo Check feature flag (PHOTO_CHECK=on). Off by default; it also needs AI.
    photo_check: bool
    # Open Food Facts by default; the end-to-end tests point it at a local stand-in.
    product_lookup_url: str
    # Whether this server runs the scheduled jobs (JOBS_ENABLED, on by default).
    jobs_enabled: bool


def ai_provider_from(value: str | None, production: bool) -> AiProvider:
    """Which AI provider to use: AI_PROVIDER, else Gemini in development and Claude in production."""
    wanted = trim(value or "").lower()
    if wanted == "":
        return "anthropic" if production else "gemini"
    if wanted == "anthropic" or wanted == "gemini":
        return wanted
    raise ValueError(f'AI_PROVIDER must be "anthropic" or "gemini" (got "{value}").')


def jobs_enabled_from(value: str | None) -> bool:
    """Whether this server runs the scheduled jobs (the reminder sweep and photo clean-up). On by default.

    While a second server shares the database (the Node server, during the fallback period), exactly one of them
    has it on; see docs/PYTHON_MIGRATION.md. Anything other than an on/off word stops the server, so a typo can
    never silently leave reminders unsent.
    """
    wanted = trim(value or "").lower()
    if wanted in ("", "true", "1", "on", "yes"):
        return True
    if wanted in ("false", "0", "off", "no"):
        return False
    raise ValueError(f'JOBS_ENABLED must be "true" or "false" (got "{value}").')


def ai_startup_warnings(config: AiConfig | None, production: bool) -> list[str]:
    """Warnings to print when the server starts.

    A Gemini key is treated as free-tier unless GEMINI_TIER=paid, and in production that is worth a warning:
    Google may use free-tier prompts (and the photos in them) to improve its products.
    """
    if production and isinstance(config, GeminiConfig) and config.tier != "paid":
        return [
            "AI_PROVIDER=gemini is using a free-tier key in production. Google may use free-tier prompts, including "
            "photos, to improve its products. Use a paid key and set GEMINI_TIER=paid, or set AI_PROVIDER=anthropic."
        ]
    return []


def _jwt_secret(environ: Mapping[str, str], production: bool) -> str:
    if secret := environ.get("JWT_SECRET"):
        return secret
    if production:
        raise ValueError("JWT_SECRET must be set in production.")
    return DEV_JWT_SECRET


def _vapid(environ: Mapping[str, str]) -> VapidConfig | None:
    """Push is switched on only when all three are set; without them, reminders still appear in the app."""
    public_key = environ.get("VAPID_PUBLIC_KEY", "")
    private_key = environ.get("VAPID_PRIVATE_KEY", "")
    subject = environ.get("VAPID_SUBJECT", "")
    return VapidConfig(public_key, private_key, subject) if public_key and private_key and subject else None


def _ai(environ: Mapping[str, str], production: bool, test: bool) -> AiConfig | None:
    """AI features are on only when the chosen provider's key is set (ANTHROPIC_API_KEY or GEMINI_API_KEY).

    Tests never read the keys, so no test can call a real API.
    """
    if test:
        return None
    provider = ai_provider_from(environ.get("AI_PROVIDER"), production)
    if provider == "gemini":
        api_key = environ.get("GEMINI_API_KEY", "")
        if not api_key:
            return None
        return GeminiConfig(
            api_key=api_key,
            fast_model=environ.get("GEMINI_MODEL_FAST") or DEFAULT_GEMINI_MODEL_FAST,
            smart_model=environ.get("GEMINI_MODEL_SMART") or DEFAULT_GEMINI_MODEL_SMART,
            tier="paid" if trim(environ.get("GEMINI_TIER", "")).lower() == "paid" else "free",
        )
    api_key = environ.get("ANTHROPIC_API_KEY", "")
    return AnthropicConfig(api_key=api_key, model=environ.get("AI_MODEL") or DEFAULT_AI_MODEL) if api_key else None


def _fcm(environ: Mapping[str, str]) -> FcmConfig | None:
    """On only when all three of the service account's values are set.

    The private key is usually pasted with "\\n" in place of its line breaks.
    """
    project_id = environ.get("FIREBASE_PROJECT_ID", "")
    client_email = environ.get("FIREBASE_CLIENT_EMAIL", "")
    private_key = environ.get("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")
    return FcmConfig(project_id, client_email, private_key) if project_id and client_email and private_key else None


def _port(value: str | None) -> int:
    # Number("") is 0 in JavaScript: any free port.
    return int(trim(value) or 0) if value is not None else 4000


def load_env(environ: Mapping[str, str]) -> Env:
    production = environ.get("NODE_ENV") == "production"
    test = environ.get("NODE_ENV") == "test"
    return Env(
        is_production=production,
        is_test=test,
        port=_port(environ.get("PORT")),
        mongo_uri=environ.get("MONGO_URI", ""),
        jwt_secret=_jwt_secret(environ, production),
        jwt_expires_in=environ.get("JWT_EXPIRES_IN", "7d"),
        client_origins=tuple(
            trim(origin) for origin in environ.get("CLIENT_ORIGIN", "http://localhost:5173").split(",") if trim(origin)
        ),
        vapid=_vapid(environ),
        ai=_ai(environ, production, test),
        fcm=_fcm(environ),
        apns_bundle_id=environ.get("APNS_BUNDLE_ID") or None,
        public_api_url=re.sub(r"/+$", "", environ.get("PUBLIC_API_URL", "")),
        photo_check=environ.get("PHOTO_CHECK") == "on",
        product_lookup_url=environ.get("PRODUCT_LOOKUP_URL") or "https://world.openfoodfacts.org",
        jobs_enabled=jobs_enabled_from(environ.get("JOBS_ENABLED")),
    )


load_dotenv(SERVER_PY / ".env", override=False)
env: Final = load_env(os.environ)
