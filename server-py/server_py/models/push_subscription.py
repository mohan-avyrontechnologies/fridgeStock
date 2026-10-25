"""Browsers and phones that receive push reminders (server/src/models/PushSubscription.ts)."""

from server_py.models.base import Model, index

PUSH_SUBSCRIPTION = Model(
    "PushSubscription",
    "pushsubscriptions",
    (index(("userId", 1), ("endpoint", 1), unique=True), index(("endpoint", 1))),
)
