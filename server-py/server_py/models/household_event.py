"""The household activity log (server/src/models/HouseholdEvent.ts)."""

from server_py.models.base import Model, index

HOUSEHOLD_EVENT = Model("HouseholdEvent", "householdevents", (index(("householdId", 1), ("createdAt", -1)),))
