"""The weekly meal plan (server/src/models/MealPlanEntry.ts)."""

from server_py.models.base import Model, index

MEAL_PLAN_ENTRY = Model(
    "MealPlanEntry", "mealplanentries", (index(("householdId", 1), ("date", 1), ("meal", 1), unique=True),)
)
