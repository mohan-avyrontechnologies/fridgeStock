"""One module per collection, as server/src/models has one per Mongoose model."""

from typing import Final

from server_py.models.ai_usage import AI_USAGE
from server_py.models.base import Model
from server_py.models.favourite import FAVOURITE
from server_py.models.food_item import FOOD_ITEM
from server_py.models.household_event import HOUSEHOLD_EVENT
from server_py.models.invite import INVITE
from server_py.models.meal_plan_entry import MEAL_PLAN_ENTRY
from server_py.models.meal_reminder_log import MEAL_REMINDER_LOG
from server_py.models.notification import NOTIFICATION
from server_py.models.push_subscription import PUSH_SUBSCRIPTION
from server_py.models.recipe_idea_cache import RECIPE_IDEA_CACHE
from server_py.models.shopping_item import SHOPPING_ITEM
from server_py.models.usage_record import USAGE_RECORD
from server_py.models.used_action_token import USED_ACTION_TOKEN
from server_py.models.user import USER

# Every Mongoose model, in the order the TypeScript server registers them.
ALL_MODELS: Final[tuple[Model, ...]] = (
    USER,
    AI_USAGE,
    FOOD_ITEM,
    MEAL_PLAN_ENTRY,
    RECIPE_IDEA_CACHE,
    FAVOURITE,
    NOTIFICATION,
    PUSH_SUBSCRIPTION,
    MEAL_REMINDER_LOG,
    USAGE_RECORD,
    USED_ACTION_TOKEN,
    SHOPPING_ITEM,
    HOUSEHOLD_EVENT,
    INVITE,
)
