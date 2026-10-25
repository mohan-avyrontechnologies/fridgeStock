"""Login and notification-action tokens (server/src/services/token.ts).

HS256 JWTs signed with the same JWT_SECRET as the TypeScript server, laid out as the `jsonwebtoken` package lays
them out ({"alg":"HS256","typ":"JWT"} and the claims in its order), so a token from either server works on the
other. Signing and the checks are written out here with the standard library's hmac, as `jsonwebtoken` does them,
rather than with PyJWT, which also refuses some tokens Node accepts (a fractional `exp`, an `iat` in the future).
"""

import base64
import binascii
import hashlib
import hmac
import json
import math
import re
import uuid
from datetime import UTC, datetime
from typing import Any, Final, cast

from server_py.config.env import env
from server_py.services import clock
from server_py.shared.js import json_parse, json_stringify, utf8

_HEADER: Final = {"alg": "HS256", "typ": "JWT"}

# The `ms` package (2.1), which `jsonwebtoken` reads JWT_EXPIRES_IN with: "7d", "12h", "1.5 hours". A bare number
# such as "3600" is milliseconds there, not seconds.
_MS_PATTERN: Final = re.compile(
    r"(-?(?:[0-9]+)?\.?[0-9]+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d"
    r"|weeks?|w|years?|yrs?|y)?",
    re.IGNORECASE,
)
_SECOND: Final = 1000
_UNIT_MS: Final = {
    "y": 365.25 * 24 * 60 * 60 * _SECOND,
    "w": 7 * 24 * 60 * 60 * _SECOND,
    "d": 24 * 60 * 60 * _SECOND,
    "h": 60 * 60 * _SECOND,
    "m": 60 * _SECOND,
    "s": _SECOND,
    "ms": 1,
}


def _unit(name: str) -> str:
    name = name.lower()
    if name.startswith(("ms", "msec", "millisecond")):
        return "ms"
    return name[0]


def parse_ms(text: str) -> float | None:
    """`ms(text)`: a time span in milliseconds, or None when it isn't one. ValueError for an empty string."""
    if text == "":
        raise ValueError(f"val is not a non-empty string or a valid number. val={json.dumps(text)}")
    if len(text) > 100:
        return None
    match = _MS_PATTERN.fullmatch(text)
    if match is None:
        return None
    return float(match[1]) * _UNIT_MS[_unit(match[2] or "ms")]


def _expiry(expires_in: str | int, issued_at: int) -> int:
    """`timespan(expiresIn, iat)` from `jsonwebtoken`."""
    if isinstance(expires_in, int):
        return issued_at + expires_in
    milliseconds = parse_ms(expires_in)
    if milliseconds is None:
        raise ValueError(
            '"expiresIn" should be a number of seconds or string representing a timespan eg: "1d", "20h", 60'
        )
    return math.floor(issued_at + milliseconds / 1000)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _signature(signing_input: str) -> str:
    return _b64(hmac.new(env.jwt_secret.encode("utf-8"), signing_input.encode("utf-8"), hashlib.sha256).digest())


def _sign(payload: dict[str, Any]) -> str:
    signing_input = f"{_b64(utf8(json_stringify(_HEADER)))}.{_b64(utf8(json_stringify(payload)))}"
    return f"{signing_input}.{_signature(signing_input)}"


def _b64_decode(segment: str) -> bytes:
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


def _verified_payload(token: str) -> object:
    """The token's payload if its signature is genuine for HS256 and this secret; ValueError otherwise."""
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("jwt malformed")
    header_segment, payload_segment, signature = parts
    try:
        header = json_parse(_b64_decode(header_segment).decode("utf-8"))
        payload_text = _b64_decode(payload_segment).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError) as error:
        raise ValueError("invalid token") from error
    if not isinstance(header, dict) or header.get("alg") != "HS256":  # pyright: ignore[reportUnknownMemberType]
        raise ValueError("invalid algorithm")
    # The signature is compared as text, as `jws` does: another spelling of the same bytes doesn't count.
    if not hmac.compare_digest(signature, _signature(f"{header_segment}.{payload_segment}")):
        raise ValueError("invalid signature")
    try:
        return json_parse(payload_text)
    except ValueError:
        # `jws` hands back the text itself when it isn't JSON.
        return payload_text


def _check_times(payload: dict[str, Any], clock_timestamp: int) -> None:
    """`jsonwebtoken`'s not-before and expiry checks, with no clock tolerance."""
    if "nbf" in payload:
        nbf = payload["nbf"]
        if not _is_number(nbf):
            raise ValueError("invalid nbf value")
        if nbf > clock_timestamp:
            raise ValueError("jwt not active")
    if "exp" in payload:
        exp = payload["exp"]
        if not _is_number(exp):
            raise ValueError("invalid exp value")
        if clock_timestamp >= exp:
            raise ValueError("jwt expired")


def _is_number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _system_seconds() -> int:
    # Login tokens are stamped with the computer's clock (as `jsonwebtoken` does), not the app's.
    return math.floor(clock.system_now().timestamp())


def sign_token(user_id: str) -> str:
    """HS256 JWT whose payload carries only the user id (TDD §7.1)."""
    issued_at = _system_seconds()
    return _sign({"iat": issued_at, "exp": _expiry(env.jwt_expires_in, issued_at), "sub": user_id})


def verify_token(token: str) -> str | None:
    """The user id a login token names, or None if it isn't a genuine, unexpired login token."""
    try:
        payload = _verified_payload(token)
        if not isinstance(payload, dict):
            return None
        _check_times(payload, _system_seconds())  # pyright: ignore[reportUnknownArgumentType]
    except ValueError:
        return None
    # Tokens with an audience (such as notification-action tokens) are never login tokens.
    if "aud" in payload:
        return None
    subject = payload.get("sub")  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    return subject if isinstance(subject, str) else None


_ACTION_AUDIENCE: Final = "push-action"
_MEAL_ACTION_AUDIENCE: Final = "meal-action"
# How long the buttons on a push notification keep working, in seconds: a day, until the next reminders.
ACTION_TOKEN_TTL_SECONDS: Final = 24 * 60 * 60


def _now_seconds() -> int:
    return math.floor(clock.now().timestamp())


def _sign_action(claims: dict[str, str], user_id: str, audience: str) -> str:
    """Signed with the app's clock, so tests can move time on; every token gets its own id."""
    issued_at = _now_seconds()
    return _sign(
        {
            **claims,
            "iat": issued_at,
            "exp": issued_at + ACTION_TOKEN_TTL_SECONDS,
            "aud": audience,
            "sub": user_id,
            "jti": str(uuid.uuid4()),
        }
    )


def _verify_action(token: str, audience: str, fields: tuple[str, ...]) -> dict[str, Any] | None:
    """The token's claims if it is genuine, for this audience and not expired; None otherwise."""
    try:
        verified = _verified_payload(token)
        if not isinstance(verified, dict):
            return None
        payload = cast(dict[str, Any], verified)
        _check_times(payload, _now_seconds())
    except ValueError:
        return None
    audiences = payload.get("aud")
    if audience not in (audiences if isinstance(audiences, list) else [audiences]):
        return None
    sub, jti, exp = payload.get("sub"), payload.get("jti"), payload.get("exp")
    if not (isinstance(sub, str) and isinstance(jti, str) and _is_number(exp)):
        return None
    if any(not isinstance(payload.get(field), str) for field in fields):
        return None
    return {
        **{field: payload[field] for field in fields},
        "userId": sub,
        "jti": jti,
        "expiresAt": datetime.fromtimestamp(exp, UTC),  # pyright: ignore[reportArgumentType]
    }


def sign_action_token(user_id: str, food_id: str) -> str:
    """A narrow token carried inside one push notification, so its "Used" and "Snooze" buttons work without the
    login token. It names one user and one food item, works for a day, can carry out one action once (see
    push_action_service), and can't be used to sign in. Each notification gets a new one."""
    return _sign_action({"foodId": food_id}, user_id, _ACTION_AUDIENCE)


def verify_action_token(token: str) -> dict[str, Any] | None:
    return _verify_action(token, _ACTION_AUDIENCE, ("foodId",))


def sign_meal_action_token(user_id: str, meal: str, date: str) -> str:
    """Like an action token, but for a meal reminder's "Snooze 30 min": it names one user, one meal and one day
    (not a food item), and can't be used to sign in or to act on food."""
    return _sign_action({"meal": meal, "date": date}, user_id, _MEAL_ACTION_AUDIENCE)


def verify_meal_action_token(token: str) -> dict[str, Any] | None:
    return _verify_action(token, _MEAL_ACTION_AUDIENCE, ("meal", "date"))
