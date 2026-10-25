"""Recipe ideas kept for a meal reminder (server/src/models/RecipeIdeaCache.ts)."""

from server_py.models.base import Model, index

RECIPE_IDEA_CACHE = Model(
    "RecipeIdeaCache",
    "recipeideacaches",
    (
        index(("householdId", 1), ("date", 1), ("mealType", 1), unique=True),
        # Kept for three days.
        index(("createdAt", 1), expire_after_seconds=3 * 24 * 60 * 60),
    ),
)
