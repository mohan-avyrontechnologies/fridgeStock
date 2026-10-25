"""Notification-action tokens already used, so each works once (server/src/models/UsedActionToken.ts)."""

from server_py.models.base import Model, index

USED_ACTION_TOKEN = Model(
    "UsedActionToken",
    "usedactiontokens",
    (
        index(("jti", 1), unique=True),
        # Gone once the token itself has expired.
        index(("expiresAt", 1), expire_after_seconds=0),
    ),
)
