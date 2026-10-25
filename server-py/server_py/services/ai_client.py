"""The AI provider (server/src/services/aiClient.ts). Requests arrive in Phase 5; for now the client is the
provider's configuration, and None means AI features are off."""

from server_py.config.env import AiConfig, env

_client: AiConfig | None = env.ai


def ai_client() -> AiConfig | None:
    return _client


def set_ai_client(client: AiConfig | None) -> None:
    """Swaps the client (tests use a fake one)."""
    global _client
    _client = client
