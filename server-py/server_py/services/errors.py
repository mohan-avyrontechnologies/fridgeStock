"""Errors raised by services and turned into `{error: {code, message, field?}}` responses
(server/src/services/errors.ts)."""

from typing import Literal

ErrorCode = Literal[
    "VALIDATION_ERROR",
    "UNAUTHENTICATED",
    "NOT_FOUND",
    "CONFLICT",
    "RATE_LIMITED",
    "AI_UNAVAILABLE",
    "SERVICE_UNAVAILABLE",
    "INTERNAL",
]


class AppError(Exception):
    def __init__(self, status: int, code: ErrorCode, message: str, field: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code: ErrorCode = code
        self.message = message
        self.field = field

    def body(self) -> dict[str, object]:
        error: dict[str, object] = {"code": self.code, "message": self.message}
        if self.field:
            error["field"] = self.field
        return {"error": error}


def validation_error(message: str, field: str | None = None) -> AppError:
    return AppError(400, "VALIDATION_ERROR", message, field)


def unauthenticated() -> AppError:
    return AppError(401, "UNAUTHENTICATED", "Authentication required.")


def food_not_found() -> AppError:
    return AppError(404, "NOT_FOUND", "Food item not found.")


def conflict(message: str, field: str | None = None) -> AppError:
    return AppError(409, "CONFLICT", message, field)


def ai_unavailable(message: str) -> AppError:
    return AppError(503, "AI_UNAVAILABLE", message)


def ai_limit_reached(message: str) -> AppError:
    return AppError(429, "RATE_LIMITED", message)
