"""Feature flags (server/src/config/features.ts)."""

from server_py.config.env import env

_photo_check_override: bool | None = None


def photo_check_enabled() -> bool:
    """Photo Check is behind a feature flag (PHOTO_CHECK=on). It also needs AI to be enabled."""
    return env.photo_check if _photo_check_override is None else _photo_check_override


def set_photo_check_enabled(value: bool | None) -> None:
    """Tests switch the flag on and off without touching the environment."""
    global _photo_check_override
    _photo_check_override = value
