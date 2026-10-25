"""Limits for AI features (server/src/config/ai.ts)."""

from typing import Final

# AI requests each user can make per calendar day (in their time zone). A request that fails isn't counted.
AI_DAILY_LIMIT: Final = 20

# Attempts per request: a result that fails validation or uses banned wording is asked for again.
AI_ATTEMPTS: Final = 3

# Request size for the receipt photo (base64 text plus a little JSON around it): '4.5mb' in the TypeScript
# server, which the `bytes` package reads as 4.5 x 1024 x 1024, rounded down.
RECEIPT_BODY_LIMIT: Final = int(4.5 * 1024 * 1024)
