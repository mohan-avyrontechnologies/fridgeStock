"""Usage history: what was used, wasted or removed (server/src/models/UsageRecord.ts)."""

from server_py.models.base import Model, index

USAGE_RECORD = Model(
    "UsageRecord",
    "usagerecords",
    (
        index(("householdId", 1)),
        index(("foodId", 1)),
        index(("userId", 1), ("date", -1), ("createdAt", -1)),
        index(("householdId", 1), ("date", -1), ("createdAt", -1)),
    ),
)
