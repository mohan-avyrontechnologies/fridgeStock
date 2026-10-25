"""Household invite codes (server/src/models/Invite.ts)."""

from server_py.models.base import Model, index

INVITE = Model("Invite", "invites", (index(("householdId", 1)), index(("code", 1), unique=True)))
