"""Sign-up, sign-in and account settings (server/src/services/authService.ts)."""

from typing import Any

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from server_py.models import user as users
from server_py.models.user import UserDoc
from server_py.schemas.auth import LoginInput, RegisterInput, UpdateAccountInput
from server_py.schemas.messages import message
from server_py.schemas.zod import MISSING, Missing
from server_py.services.errors import AppError, conflict
from server_py.services.password_hash import hash_password, verify_password
from server_py.services.time_zone import is_valid_time_zone
from server_py.services.token import sign_token
from server_py.services.views import to_user_view


def _email_taken() -> AppError:
    return conflict("An account with this email already exists.", "email")


def _invalid_credentials() -> AppError:
    # The same response for an unknown email and a wrong password.
    return AppError(401, "UNAUTHENTICATED", message("invalidCredentials"))


def _zone_or_default(time_zone: str | Missing, fallback: str) -> str:
    return time_zone if time_zone is not MISSING and time_zone and is_valid_time_zone(time_zone) else fallback


# Compared against when the email is unknown, so both paths cost a bcrypt check.
_dummy_hash: str | None = None


async def _get_dummy_hash() -> str:
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = await hash_password("not-a-real-password")
    return _dummy_hash


async def register(body: RegisterInput) -> dict[str, Any]:
    if await users.exists_with_email(body.email):
        raise _email_taken()
    try:
        user = await users.create(
            name=body.name,
            email=body.email,
            password_hash=await hash_password(body.password),
            time_zone=_zone_or_default(body.time_zone, "UTC"),
            # A new account is shown the first-run guide once.
            first_run_done=False,
        )
    except DuplicateKeyError:
        # Two simultaneous sign-ups can both pass the exists check.
        raise _email_taken() from None
    return {"token": sign_token(str(user.id)), "user": to_user_view(user)}


async def login(body: LoginInput) -> dict[str, Any]:
    user = await users.find_by_email(body.email)
    valid = await verify_password(body.password, user.password_hash if user else await _get_dummy_hash())
    if not user or not valid:
        raise _invalid_credentials()

    # Keep "today" aligned with wherever the user is signing in from.
    zone = _zone_or_default(body.time_zone, user.time_zone)
    if zone != user.time_zone:
        user.time_zone = zone
        await users.save_user(user)
    return {"token": sign_token(str(user.id)), "user": to_user_view(user)}


async def update_account(user: UserDoc, body: UpdateAccountInput) -> dict[str, Any]:
    if body.time_zone is not MISSING and not is_valid_time_zone(body.time_zone):
        raise AppError(400, "VALIDATION_ERROR", "Time zone is not recognised.", "timeZone")
    if body.name is not MISSING:
        user.name = body.name
    if body.time_zone is not MISSING:
        user.time_zone = body.time_zone
    if body.currency is not MISSING:
        user.currency = body.currency
    if body.save_photos is not MISSING:
        user.save_photos = body.save_photos
    if body.first_run_done is not MISSING:
        user.first_run_done = body.first_run_done
    await users.save_user(user)
    return to_user_view(user)


async def find_user_by_id(user_id: str | ObjectId) -> UserDoc | None:
    """The user named by a verified token, or None if they no longer exist."""
    return await users.find_by_id(user_id)
