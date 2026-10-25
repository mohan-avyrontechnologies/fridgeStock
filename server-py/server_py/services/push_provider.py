"""Who delivers push reminders (server/src/services/pushProvider.ts): Web Push for browsers when the VAPID keys
are set, Firebase for the Android and iOS apps when its service account is. Sending arrives with the reminders
(Phase 4); for now each provider is the configuration it will send with."""

from server_py.config.env import FcmConfig, VapidConfig, env

_web: VapidConfig | None = env.vapid
_native: FcmConfig | None = env.fcm


def push_provider() -> VapidConfig | None:
    """The Web Push provider, or None when it isn't configured."""
    return _web


def native_push_provider() -> FcmConfig | None:
    """The provider for the Android and iOS apps (Firebase), or None when it isn't configured."""
    return _native


def set_push_provider(provider: VapidConfig | None) -> None:
    """Swaps the Web Push provider (tests use a fake one)."""
    global _web
    _web = provider


def set_native_push_provider(provider: FcmConfig | None) -> None:
    global _native
    _native = provider
