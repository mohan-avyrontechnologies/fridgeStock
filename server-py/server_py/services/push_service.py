"""Push subscriptions and settings (server/src/services/pushService.ts). Phase 1 has the configuration."""

from typing import Any

from server_py.services.push_provider import native_push_provider, push_provider


def config() -> dict[str, Any]:
    """GET /push/config: the VAPID public key (or null), and whether push to the apps is set up."""
    web = push_provider()
    return {"publicKey": web.public_key if web else None, "native": native_push_provider() is not None}
