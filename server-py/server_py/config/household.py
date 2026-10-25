"""Limits for shared households (server/src/config/household.ts)."""

from typing import Final

HOUSEHOLD_MAX_MEMBERS: Final = 6
# How long an invite code works.
INVITE_DAYS: Final = 7
# How many open invites one household may have at once.
MAX_OPEN_INVITES: Final = 5
