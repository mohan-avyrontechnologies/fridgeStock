"""Sign-up, sign-in and account settings (registerSchema, loginSchema, updateAccountSchema in
shared/src/schemas.ts)."""

from server_py.schemas import zod as z
from server_py.schemas.base import RequestModel, zod
from server_py.schemas.messages import message
from server_py.schemas.zod import Missing
from server_py.shared.enums import CURRENCIES, Currency

EMAIL = z.string(message("email")).trim().to_lower().pipe(z.email(message("email")))

NAME = z.string(message("name")).trim().min(1, message("name")).max(50, message("nameTooLong"))


class RegisterInput(RequestModel):
    name: str = zod(NAME)
    email: str = zod(EMAIL)
    password: str = zod(z.string(message("password")).min(8, message("password")).max(128, message("passwordTooLong")))
    time_zone: str | Missing = zod(z.string().optional(), alias="timeZone")


class LoginInput(RequestModel):
    email: str = zod(EMAIL)
    password: str = zod(z.string(message("loginPassword")).min(1, message("loginPassword")))
    time_zone: str | Missing = zod(z.string().optional(), alias="timeZone")


class UpdateAccountInput(RequestModel):
    """Every field is optional (the zod object is `.partial()`)."""

    name: str | Missing = zod(NAME.optional())
    time_zone: str | Missing = zod(z.string().optional(), alias="timeZone")
    currency: Currency | Missing = zod(z.enum_of(CURRENCIES, message("currency")).optional())
    # Keep a photo with each food item you add by camera.
    save_photos: bool | Missing = zod(z.boolean().optional(), alias="savePhotos")
    # The first-run guide was finished or skipped.
    first_run_done: bool | Missing = zod(z.boolean().optional(), alias="firstRunDone")
