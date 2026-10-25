"""Accounts (server/src/models/User.ts)."""

from datetime import datetime
from typing import Any, Final

from bson import ObjectId

from server_py.models.base import (
    Default,
    Document,
    DocumentValidationError,
    Model,
    as_object_id,
    check_length,
    index,
    new_id,
    save,
)
from server_py.services import clock
from server_py.shared.alerts import DEFAULT_ALERTS, DEFAULT_MEAL_REMINDERS
from server_py.shared.enums import Currency
from server_py.shared.js import trim

USER: Final = Model("User", "users", (index(("email", 1), unique=True), index(("householdId", 1))))

# The schema's defaults, which Mongoose fills in for older accounts that predate a field.
DEFAULTS: Final[dict[str, Default]] = {
    # IANA zone used to decide which calendar day is "today" for this user.
    "timeZone": "UTC",
    "currency": "USD",
    # Keep a photo with each food item added by camera.
    "savePhotos": True,
    # The first-run guide has been seen or skipped. Accounts that predate it have no value, which reads as done.
    "firstRunDone": True,
    "notificationPreferences.approachingExpiry": True,
    "notificationPreferences.due": True,
    "notificationPreferences.overdue": True,
    # Every user starts in their own household.
    "householdId": new_id,
    # Push reminders: a daily summary by default, at 8:00 in the user's time zone.
    "reminderDelivery.mode": "DIGEST",
    "reminderDelivery.hour": 8,
    # The user's calendar day the last daily digest was pushed on.
    "lastDigestDate": None,
    "alerts.sound": DEFAULT_ALERTS["sound"],
    "alerts.vibration": DEFAULT_ALERTS["vibration"],
    "alerts.quietHours.enabled": DEFAULT_ALERTS["quietHours"]["enabled"],
    "alerts.quietHours.start": DEFAULT_ALERTS["quietHours"]["start"],
    "alerts.quietHours.end": DEFAULT_ALERTS["quietHours"]["end"],
    **{f"mealReminders.{meal}.enabled": setting["enabled"] for meal, setting in DEFAULT_MEAL_REMINDERS.items()},
    **{f"mealReminders.{meal}.time": setting["time"] for meal, setting in DEFAULT_MEAL_REMINDERS.items()},
}


class UserDoc(Document):
    """A user as Mongoose hydrates one: every default filled in."""

    def __init__(self, stored: dict[str, Any]) -> None:
        super().__init__(stored, defaults=DEFAULTS)

    @property
    def name(self) -> str:
        return self.data["name"]

    @name.setter
    def name(self, value: str) -> None:
        # The schema trims names.
        self.data["name"] = trim(value)

    @property
    def email(self) -> str:
        return self.data["email"]

    @property
    def password_hash(self) -> str:
        return self.data["passwordHash"]

    @property
    def time_zone(self) -> str:
        return self.data["timeZone"]

    @time_zone.setter
    def time_zone(self, value: str) -> None:
        self.data["timeZone"] = value

    @property
    def currency(self) -> Currency:
        return self.data["currency"]

    @currency.setter
    def currency(self, value: Currency) -> None:
        self.data["currency"] = value

    @property
    def save_photos(self) -> bool:
        return self.data["savePhotos"]

    @save_photos.setter
    def save_photos(self, value: bool) -> None:
        self.data["savePhotos"] = value

    @property
    def first_run_done(self) -> bool:
        return self.data["firstRunDone"]

    @first_run_done.setter
    def first_run_done(self, value: bool) -> None:
        self.data["firstRunDone"] = value

    @property
    def household_id(self) -> ObjectId:
        return self.data["householdId"]

    @property
    def created_at(self) -> datetime | None:
        return self.data.get("createdAt")

    @property
    def updated_at(self) -> datetime | None:
        return self.data.get("updatedAt")


def _new_document(name: str, email: str, password_hash: str, time_zone: str, first_run_done: bool) -> dict[str, Any]:
    """A new account laid out exactly as `UserModel.create` writes it, with every default."""
    now = clock.system_now()
    return {
        "_id": new_id(),
        "name": trim(name),
        "email": trim(email.lower()),
        "passwordHash": password_hash,
        "timeZone": time_zone,
        "currency": DEFAULTS["currency"],
        "savePhotos": DEFAULTS["savePhotos"],
        "firstRunDone": first_run_done,
        "notificationPreferences": {"approachingExpiry": True, "due": True, "overdue": True},
        "reminderDelivery": {"mode": DEFAULTS["reminderDelivery.mode"], "hour": DEFAULTS["reminderDelivery.hour"]},
        "lastDigestDate": None,
        "alerts": {
            "quietHours": dict(DEFAULT_ALERTS["quietHours"]),
            "sound": DEFAULT_ALERTS["sound"],
            "vibration": DEFAULT_ALERTS["vibration"],
        },
        "mealReminders": {meal: dict(setting) for meal, setting in DEFAULT_MEAL_REMINDERS.items()},
        "householdId": new_id(),
        "createdAt": now,
        "updatedAt": now,
        "__v": 0,
    }


def _validate(document: dict[str, Any]) -> None:
    """The schema's own rule that a request can get past: a name of 1 to 50 UTF-16 units (an emoji counts 2,
    where the request schema counts it once)."""
    if problem := check_length("name", document["name"], 1, 50):
        raise DocumentValidationError({"name": problem})


async def create(name: str, email: str, password_hash: str, time_zone: str, first_run_done: bool) -> UserDoc:
    """Insert a new account. DuplicateKeyError (code 11000) if the email is taken; DocumentValidationError if the
    schema refuses it."""
    document = _new_document(name, email, password_hash, time_zone, first_run_done)
    _validate(document)
    await USER.collection().insert_one(document)
    return UserDoc(document)


async def exists_with_email(email: str) -> bool:
    return await USER.collection().find_one({"email": email}, {"_id": 1}) is not None


async def find_by_email(email: str) -> UserDoc | None:
    stored = await USER.collection().find_one({"email": email})
    return UserDoc(stored) if stored else None


async def find_by_id(user_id: str | ObjectId) -> UserDoc | None:
    stored = await USER.collection().find_one({"_id": as_object_id(user_id)})
    return UserDoc(stored) if stored else None


async def save_user(user: UserDoc) -> None:
    # Mongoose checks the paths that changed.
    if user.data.get("name") != user.stored.get("name"):
        _validate(user.data)
    await save(USER, user)
