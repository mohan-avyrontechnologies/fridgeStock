"""Documents and indexes are the ones Mongoose writes (docs/PYTHON_MIGRATION.md §4, "Data"), and the start-up
migrations (migrations.ts) do what they do there. Includes the migration test from
server/src/tests/phase1.test.ts; that file's other tests need the food routes and arrive with Phase 2.

The expected indexes, document layouts and save results were recorded from Mongoose 9 itself.
"""

from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from server_py.models import ALL_MODELS
from server_py.models.base import sync_indexes
from server_py.models.food_item import FOOD_ITEM
from server_py.models.meal_plan_entry import MEAL_PLAN_ENTRY
from server_py.models.migrations import ensure_all_indexes, run_migrations
from server_py.models.notification import NOTIFICATION
from server_py.models.usage_record import USAGE_RECORD
from server_py.models.user import USER, UserDoc, find_by_id, save_user
from tests.conftest import register_user

pytestmark = pytest.mark.phase1

Database = AsyncDatabase[dict[str, Any]]

# listIndexes for each collection, after Mongoose's autoIndex and runMigrations (the _id index left out).
MONGOOSE_INDEXES: dict[str, list[dict[str, Any]]] = {
    "aiusages": [{"key": {"userId": 1, "date": 1}, "name": "userId_1_date_1", "unique": True}],
    "favourites": [{"key": {"userId": 1, "nameKey": 1}, "name": "userId_1_nameKey_1", "unique": True}],
    "fooditems": [
        {"key": {"userId": 1}, "name": "userId_1"},
        {"key": {"householdId": 1}, "name": "householdId_1"},
        {"key": {"userId": 1, "status": 1}, "name": "userId_1_status_1"},
        {"key": {"userId": 1, "expiryDate": 1}, "name": "userId_1_expiryDate_1"},
    ],
    "householdevents": [{"key": {"householdId": 1, "createdAt": -1}, "name": "householdId_1_createdAt_-1"}],
    "invites": [
        {"key": {"householdId": 1}, "name": "householdId_1"},
        {"key": {"code": 1}, "name": "code_1", "unique": True},
    ],
    "mealplanentries": [
        {"key": {"householdId": 1, "date": 1, "meal": 1}, "name": "householdId_1_date_1_meal_1", "unique": True}
    ],
    "mealreminderlogs": [
        {"key": {"userId": 1, "date": 1, "meal": 1}, "name": "userId_1_date_1_meal_1", "unique": True},
        {"key": {"createdAt": 1}, "name": "createdAt_1", "expireAfterSeconds": 604800},
    ],
    "notifications": [
        {"key": {"foodId": 1}, "name": "foodId_1"},
        {
            "key": {"userId": 1, "foodId": 1, "type": 1, "expiryDate": 1},
            "name": "userId_1_foodId_1_type_1_expiryDate_1",
            "unique": True,
        },
        {"key": {"userId": 1, "status": 1, "scheduledDate": 1}, "name": "userId_1_status_1_scheduledDate_1"},
        {"key": {"userId": 1, "sentAt": -1}, "name": "userId_1_sentAt_-1"},
    ],
    "pushsubscriptions": [
        {"key": {"userId": 1, "endpoint": 1}, "name": "userId_1_endpoint_1", "unique": True},
        {"key": {"endpoint": 1}, "name": "endpoint_1"},
    ],
    "recipeideacaches": [
        {
            "key": {"householdId": 1, "date": 1, "mealType": 1},
            "name": "householdId_1_date_1_mealType_1",
            "unique": True,
        },
        {"key": {"createdAt": 1}, "name": "createdAt_1", "expireAfterSeconds": 259200},
    ],
    "shoppingitems": [
        {"key": {"householdId": 1}, "name": "householdId_1"},
        {"key": {"householdId": 1, "checked": 1, "createdAt": 1}, "name": "householdId_1_checked_1_createdAt_1"},
    ],
    "usagerecords": [
        {"key": {"householdId": 1}, "name": "householdId_1"},
        {"key": {"foodId": 1}, "name": "foodId_1"},
        {"key": {"userId": 1, "date": -1, "createdAt": -1}, "name": "userId_1_date_-1_createdAt_-1"},
        {"key": {"householdId": 1, "date": -1, "createdAt": -1}, "name": "householdId_1_date_-1_createdAt_-1"},
    ],
    "usedactiontokens": [
        {"key": {"jti": 1}, "name": "jti_1", "unique": True},
        {"key": {"expiresAt": 1}, "name": "expiresAt_1", "expireAfterSeconds": 0},
    ],
    "users": [
        {"key": {"email": 1}, "name": "email_1", "unique": True},
        {"key": {"householdId": 1}, "name": "householdId_1"},
    ],
}


async def indexes(database: Database, collection: str) -> list[dict[str, Any]]:
    cursor = await database[collection].list_indexes()
    found = [dict(entry) async for entry in cursor]
    return [{k: v for k, v in entry.items() if k != "v"} for entry in found if entry["name"] != "_id_"]


async def test_every_collection_has_exactly_mongooses_indexes(database: Database) -> None:
    for name in await database.list_collection_names():
        await database.drop_collection(name)
    await ensure_all_indexes()
    await run_migrations()
    assert sorted(await database.list_collection_names()) == sorted(MONGOOSE_INDEXES)
    for collection, expected in MONGOOSE_INDEXES.items():
        assert await indexes(database, collection) == expected, collection
    assert [model.collection_name for model in ALL_MODELS] == [
        "users", "aiusages", "fooditems", "mealplanentries", "recipeideacaches", "favourites", "notifications",
        "pushsubscriptions", "mealreminderlogs", "usagerecords", "usedactiontokens", "shoppingitems",
        "householdevents", "invites",
    ]  # fmt: skip


async def test_sync_indexes_drops_an_index_the_model_no_longer_has(database: Database) -> None:
    # The pre-v1.3 reminder index, and one that differs from the model's only in an option.
    await NOTIFICATION.collection().create_index([("foodId", 1), ("type", 1)], name="foodId_1_type_1", unique=True)
    await NOTIFICATION.collection().drop_index("userId_1_sentAt_-1")
    await NOTIFICATION.collection().create_index([("userId", 1), ("sentAt", -1)], unique=True)
    await sync_indexes(NOTIFICATION)
    assert await indexes(database, "notifications") == [
        *[i for i in MONGOOSE_INDEXES["notifications"] if i["name"] != "userId_1_sentAt_-1"],
        {"key": {"userId": 1, "sentAt": -1}, "name": "userId_1_sentAt_-1"},
    ]


class TestUserDocuments:
    async def test_a_new_account_is_laid_out_as_mongoose_writes_it(self, api: httpx.AsyncClient) -> None:
        await register_user(api, name=" Asha ", email="A@x.com", password="longenough", timeZone="Asia/Kolkata")
        stored = await USER.collection().find_one({})
        assert stored is not None
        assert list(stored) == [
            "_id", "name", "email", "passwordHash", "timeZone", "currency", "savePhotos", "firstRunDone",
            "notificationPreferences", "reminderDelivery", "lastDigestDate", "alerts", "mealReminders",
            "householdId", "createdAt", "updatedAt", "__v",
        ]  # fmt: skip
        assert {
            k: v for k, v in stored.items() if k not in ("_id", "passwordHash", "householdId", "createdAt", "updatedAt")
        } == {
            "name": "Asha",
            "email": "a@x.com",
            "timeZone": "Asia/Kolkata",
            "currency": "USD",
            "savePhotos": True,
            "firstRunDone": False,
            "notificationPreferences": {"approachingExpiry": True, "due": True, "overdue": True},
            "reminderDelivery": {"mode": "DIGEST", "hour": 8},
            "lastDigestDate": None,
            "alerts": {
                "quietHours": {"enabled": True, "start": "22:00", "end": "07:00"},
                "sound": True,
                "vibration": True,
            },
            "mealReminders": {
                "breakfast": {"enabled": False, "time": "07:30"},
                "lunch": {"enabled": False, "time": "12:30"},
                "dinner": {"enabled": False, "time": "19:30"},
            },
            "__v": 0,
        }
        assert list(stored["alerts"]["quietHours"]) == ["enabled", "start", "end"]
        assert isinstance(stored["_id"], ObjectId)
        assert isinstance(stored["householdId"], ObjectId)
        assert stored["createdAt"] == stored["updatedAt"]
        assert stored["createdAt"].microsecond % 1000 == 0

    async def test_an_old_account_gets_the_defaults_when_read(self, database: Database) -> None:
        inserted = await USER.collection().insert_one(
            {"name": "Very", "email": "v@x.com", "passwordHash": "x", "notificationPreferences": {"due": False}}
        )
        user = await find_by_id(inserted.inserted_id)
        assert user is not None
        assert user.get("notificationPreferences") == {"due": False, "approachingExpiry": True, "overdue": True}
        assert (user.time_zone, user.currency, user.save_photos, user.first_run_done) == ("UTC", "USD", True, True)
        assert user.get("lastDigestDate") is None
        assert user.get("reminderDelivery") == {"mode": "DIGEST", "hour": 8}
        assert isinstance(user.household_id, ObjectId)

    async def test_saving_writes_missing_defaults_without_touching_updated_at(self, database: Database) -> None:
        household = ObjectId()
        inserted = await USER.collection().insert_one(
            {"name": "Old", "email": "old@x.com", "passwordHash": "x", "timeZone": "UTC", "householdId": household}
        )
        user = await find_by_id(inserted.inserted_id)
        assert user is not None
        await save_user(user)
        # What Mongoose's save() left in the document: dotted $set paths, which MongoDB applies in name order.
        assert await USER.collection().find_one({"_id": inserted.inserted_id}) == {
            "_id": inserted.inserted_id,
            "name": "Old",
            "email": "old@x.com",
            "passwordHash": "x",
            "timeZone": "UTC",
            "householdId": household,
            "alerts": {
                "quietHours": {"enabled": True, "end": "07:00", "start": "22:00"},
                "sound": True,
                "vibration": True,
            },
            "currency": "USD",
            "firstRunDone": True,
            "mealReminders": {
                "breakfast": {"enabled": False, "time": "07:30"},
                "dinner": {"enabled": False, "time": "19:30"},
                "lunch": {"enabled": False, "time": "12:30"},
            },
            "notificationPreferences": {"approachingExpiry": True, "due": True, "overdue": True},
            "reminderDelivery": {"hour": 8, "mode": "DIGEST"},
            "savePhotos": True,
        }
        stored = await USER.collection().find_one({"_id": inserted.inserted_id})
        assert stored is not None
        assert list(stored)[6:] == [
            "alerts", "currency", "firstRunDone", "mealReminders", "notificationPreferences", "reminderDelivery",
            "savePhotos",
        ]  # fmt: skip
        assert list(stored["alerts"]["quietHours"]) == ["enabled", "end", "start"]

        # A real change is written with updatedAt, and createdAt stays missing.
        reloaded = await find_by_id(inserted.inserted_id)
        assert reloaded is not None
        reloaded.time_zone = "Europe/London"
        await save_user(reloaded)
        after = await USER.collection().find_one({"_id": inserted.inserted_id})
        assert after is not None
        assert after["timeZone"] == "Europe/London"
        assert isinstance(after["updatedAt"], datetime)
        assert "createdAt" not in after
        assert list(after)[-1] == "updatedAt"

    async def test_saving_an_unchanged_account_writes_nothing(self, api: httpx.AsyncClient) -> None:
        account = await register_user(api)
        before = await USER.collection().find_one({"email": account.user["email"]})
        assert before is not None
        res = await api.put("/api/auth/me", headers=account.headers, json={"name": account.user["name"]})
        assert res.status_code == 200
        assert await USER.collection().find_one({"email": account.user["email"]}) == before
        changed = await api.put("/api/auth/me", headers=account.headers, json={"currency": "GBP", "name": "New"})
        assert changed.json()["user"]["currency"] == "GBP"
        after = await USER.collection().find_one({"email": account.user["email"]})
        assert after is not None
        assert (after["name"], after["currency"]) == ("New", "GBP")
        assert after["updatedAt"] >= before["updatedAt"]
        assert after["createdAt"] == before["createdAt"]

    async def test_names_are_trimmed_by_the_model_too(self, database: Database) -> None:
        user = UserDoc({"_id": ObjectId(), "name": "A", "email": "a@x.com", "passwordHash": "x"})
        user.name = "  B  "
        assert user.name == "B"


class TestMigrations:
    async def test_existing_data_is_backfilled_users_get_a_household_items_get_it_plus_fridge(
        self, database: Database
    ) -> None:
        """phase1.test.ts: "existing data is backfilled"."""
        user = await USER.collection().insert_one({"name": "Old", "email": "old@example.com", "passwordHash": "x"})
        item = await FOOD_ITEM.collection().insert_one(
            {
                "userId": user.inserted_id,
                "name": "Old milk",
                "quantity": 1,
                "unit": "l",
                "addedDate": "2026-09-20",
                "lifespanDays": 4,
                "expiryDate": "2026-09-24",
                "status": "ACTIVE",
            }
        )
        await run_migrations()
        u = await USER.collection().find_one({"_id": user.inserted_id})
        f = await FOOD_ITEM.collection().find_one({"_id": item.inserted_id})
        assert u is not None
        assert f is not None
        assert isinstance(u["householdId"], ObjectId)
        assert f["householdId"] == u["householdId"]
        assert f["storage"] == "FRIDGE"
        assert f["openedDate"] is None
        assert (f["enteredLifespanDays"], f["enteredStorage"]) == (4, "FRIDGE")

    async def test_shared_records_meal_defaults_and_old_dates(self, database: Database) -> None:
        household = ObjectId()
        user = await USER.collection().insert_one(
            {"name": "U", "email": "u@x.com", "passwordHash": "x", "householdId": household}
        )
        usage = await USAGE_RECORD.collection().insert_one(
            {"userId": user.inserted_id, "date": datetime(2026, 9, 20, tzinfo=UTC)}
        )
        plan = await MEAL_PLAN_ENTRY.collection().insert_one({"userId": user.inserted_id, "date": "2026-09-21"})
        food = await FOOD_ITEM.collection().insert_one(
            {
                "userId": user.inserted_id,
                "householdId": household,
                "addedDate": datetime(2026, 9, 1, tzinfo=UTC),
                "expiryDate": datetime(2026, 9, 5, tzinfo=UTC),
                "storage": "PANTRY",
                "openedDate": "2026-09-02",
                "lifespanDays": 4,
                "enteredLifespanDays": 9,
                "enteredStorage": "FREEZER",
            }
        )
        await run_migrations()
        await run_migrations()  # safe to run again
        u = await USAGE_RECORD.collection().find_one({"_id": usage.inserted_id})
        p = await MEAL_PLAN_ENTRY.collection().find_one({"_id": plan.inserted_id})
        f = await FOOD_ITEM.collection().find_one({"_id": food.inserted_id})
        assert u is not None
        assert p is not None
        assert f is not None
        assert (u["householdId"], u["date"]) == (household, "2026-09-20")
        assert (p["householdId"], p["meal"]) == (household, "dinner")
        assert (f["addedDate"], f["expiryDate"]) == ("2026-09-01", "2026-09-05")
        # Values that were already there are left alone.
        assert (f["storage"], f["openedDate"], f["enteredLifespanDays"], f["enteredStorage"]) == (
            "PANTRY",
            "2026-09-02",
            9,
            "FREEZER",
        )
