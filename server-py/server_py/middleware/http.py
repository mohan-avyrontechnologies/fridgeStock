"""The HTTP behaviour Express and its packages give the TypeScript server, as ASGI middleware (server/src/app.ts).

From the outside in, as app.ts stacks them:
- `SecurityHeaders`: helmet's headers on every response, and cors: the allowed origins (CLIENT_ORIGIN plus the
  native apps) and the answer to every preflight (OPTIONS) request.
- `RequestLog`: method, route, status and time of each request, never bodies or headers (not in tests).
- `ExpressSend`: what `res.send` adds: a weak ETag, 304 Not Modified for a matching If-None-Match, no body for
  HEAD, and no Content-Type or Content-Length on 204 and 304.
- `BodyParser`: `express.json()`, with its limits (20 KB, or RECEIPT_BODY_LIMIT on the two photo routes), its
  content encodings (gzip, deflate, br) and charsets, and its refusals worded as errorHandler.ts words them.

Each response is a JSON body written as JSON.stringify writes it (`json_response`).
"""

import base64
import hashlib
import re
import sys
import time
import zlib
from collections.abc import Awaitable, Callable, Iterable, Mapping
from typing import Any, Final

import brotli
from starlette.datastructures import Headers
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from server_py.config.ai import RECEIPT_BODY_LIMIT
from server_py.config.env import env
from server_py.config.native import NATIVE_APP_ORIGINS
from server_py.schemas.zod import MISSING
from server_py.shared.js import json_parse, json_stringify

JSON_TYPE: Final = "application/json; charset=utf-8"

Step = Callable[[Request], Awaitable[Response | None]]
"""A route's middleware or controller: a response ends the chain; None goes on to the next step."""


def json_response(status: int, body: object, headers: Mapping[str, str] | None = None) -> Response:
    """`res.status(status).json(body)`."""
    return Response(json_stringify(body).encode("utf-8"), status, dict(headers or {}), media_type=JSON_TYPE)


def response_headers(request: Request) -> dict[str, str]:
    """Headers a middleware asked to be added to whatever response is sent (the rate-limit headers)."""
    headers: dict[str, str] = request.scope.setdefault("state", {}).setdefault("response_headers", {})
    return headers


def error_response(status: int, code: str, message: str) -> Response:
    return json_response(status, {"error": {"code": code, "message": message}})


# helmet 8's defaults, in its order.
HELMET_HEADERS: Final = (
    (
        "content-security-policy",
        "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';"
        "img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';"
        "style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests",
    ),
    ("cross-origin-opener-policy", "same-origin"),
    ("cross-origin-resource-policy", "same-origin"),
    ("origin-agent-cluster", "?1"),
    ("referrer-policy", "no-referrer"),
    ("strict-transport-security", "max-age=31536000; includeSubDomains"),
    ("x-content-type-options", "nosniff"),
    ("x-dns-prefetch-control", "off"),
    ("x-download-options", "noopen"),
    ("x-frame-options", "SAMEORIGIN"),
    ("x-permitted-cross-domain-policies", "none"),
    ("x-xss-protection", "0"),
)

_PREFLIGHT_METHODS: Final = "GET,HEAD,PUT,PATCH,POST,DELETE"


def _raw(headers: Iterable[tuple[str, str]]) -> list[tuple[bytes, bytes]]:
    return [(name.encode("latin-1"), value.encode("latin-1")) for name, value in headers]


def _set_header(message: Message, name: str, value: str) -> None:
    """Replace (or add) one response header, as `res.setHeader` does."""
    key = name.lower().encode("latin-1")
    headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != key]
    headers.append((key, value.encode("latin-1")))
    message["headers"] = headers


def _append_vary(message: Message, field: str) -> None:
    """The `vary` package: add a field to Vary unless it is there already."""
    existing = next((v.decode("latin-1") for k, v in message.get("headers", []) if k.lower() == b"vary"), "")
    fields = [f.strip() for f in existing.split(",") if f.strip()]
    if "*" in fields or field.lower() in (f.lower() for f in fields):
        return
    _set_header(message, "vary", ", ".join([*fields, field]))


class SecurityHeaders:
    """helmet() then cors({origin: [...clientOrigins, ...NATIVE_APP_ORIGINS]})."""

    def __init__(self, app: ASGIApp, origins: Iterable[str] | None = None) -> None:
        self.app = app
        self.origins = frozenset(origins if origins is not None else (*env.client_origins, *NATIVE_APP_ORIGINS))

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        origin = headers.get("origin")
        allowed = origin if origin is not None and origin in self.origins else None

        if scope["method"] == "OPTIONS":
            # Every OPTIONS request is answered as a preflight, whatever its path.
            message: Message = {"type": "http.response.start", "status": 204, "headers": _raw(HELMET_HEADERS)}
            if allowed:
                _set_header(message, "access-control-allow-origin", allowed)
            _append_vary(message, "Origin")
            _set_header(message, "access-control-allow-methods", _PREFLIGHT_METHODS)
            if requested := headers.get("access-control-request-headers"):
                _set_header(message, "access-control-allow-headers", requested)
            _append_vary(message, "Access-Control-Request-Headers")
            _set_header(message, "content-length", "0")
            await send(message)
            await send({"type": "http.response.body", "body": b""})
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                given = list(message.get("headers", []))
                message["headers"] = [*_raw(HELMET_HEADERS), *given]
                if allowed:
                    _set_header(message, "access-control-allow-origin", allowed)
                _append_vary(message, "Origin")
            await send(message)

        await self.app(scope, receive, send_with_headers)


def weak_etag(body: bytes) -> str:
    """The `etag` package's weak ETag: W/"<length in hex>-<first 27 characters of the base64 SHA-1>"."""
    digest = base64.b64encode(hashlib.sha1(body).digest()).decode("ascii")[:27]
    return f'W/"{len(body):x}-{digest}"'


_NO_CACHE: Final = re.compile(r"(?:^|,)\s*?no-cache\s*?(?:,|$)")


def _is_fresh(request: Headers, etag: str) -> bool:
    """The `fresh` package, for a response with an ETag and no Last-Modified."""
    modified_since = request.get("if-modified-since")
    none_match = request.get("if-none-match")
    if not modified_since and not none_match:
        return False
    if (cache_control := request.get("cache-control")) and _NO_CACHE.search(cache_control):
        return False
    if none_match and none_match != "*":
        tokens = [token for token in re.split(r"[ ,]+", none_match) if token]
        if not any(t == etag or t == f"W/{etag}" or f"W/{t}" == etag for t in tokens):
            return False
    # With no Last-Modified, an If-Modified-Since always counts as stale.
    return not modified_since


class ExpressSend:
    """What `res.send` does around every body: ETag, 304, HEAD, and the headers 204 and 304 leave out."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        start: Message | None = None
        chunks: list[bytes] = []

        async def buffered(message: Message) -> None:
            nonlocal start
            if message["type"] == "http.response.start":
                start = message
                return
            if message["type"] != "http.response.body":
                await send(message)
                return
            chunks.append(message.get("body", b""))
            if message.get("more_body", False):
                return
            assert start is not None
            await send_final(start, b"".join(chunks))

        async def send_final(start: Message, body: bytes) -> None:
            status: int = start["status"]
            if status not in (204, 304):
                etag = weak_etag(body)
                _set_header(start, "etag", etag)
                fresh = (
                    scope["method"] in ("GET", "HEAD") and 200 <= status < 300 and _is_fresh(Headers(scope=scope), etag)
                )
                if fresh:
                    status = start["status"] = 304
            if status in (204, 304):
                start["headers"] = [
                    (k, v)
                    for k, v in start.get("headers", [])
                    if k.lower() not in (b"content-type", b"content-length", b"transfer-encoding")
                ]
                body = b""
            if scope["method"] == "HEAD":
                body = b""
            await send(start)
            await send({"type": "http.response.body", "body": body})

        await self.app(scope, receive, buffered)


class _BodyError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


_TOO_LARGE: Final = "That request is too large."
_NOT_JSON: Final = "Request body is not valid JSON."
_UNREADABLE: Final = "The request body couldn't be read."
# The JSON body limit everywhere except the two routes that carry a photo ('20kb').
BODY_LIMIT: Final = 20 * 1024
_PHOTO_ROUTES: Final = ("/api/parse/receipt", "/api/parse/photo")

_TOKEN: Final = r"[!#$%&'*+.^_`|~0-9A-Za-z-]+"
_CONTENT_TYPE: Final = re.compile(rf"\s*({_TOKEN}/{_TOKEN})\s*((?:;\s*{_TOKEN}=(?:{_TOKEN}|\"(?:[^\"\\]|\\.)*\")\s*)*)")
_PARAMETER: Final = re.compile(rf";\s*({_TOKEN})=({_TOKEN}|\"(?:[^\"\\]|\\.)*\")")
# JSON's own whitespace, which body-parser skips before checking the first character.
_JSON_FIRST: Final = re.compile(r"[\x20\x09\x0a\x0d]*([^\x20\x09\x0a\x0d])")


def _content_type(header: str | None) -> tuple[str, dict[str, str]] | None:
    """The media type and parameters (the `content-type` package), or None if the header is missing or malformed."""
    if header is None:
        return None
    match = _CONTENT_TYPE.fullmatch(header)
    if match is None:
        return None
    parameters: dict[str, str] = {}
    for name, value in _PARAMETER.findall(match[2]):
        if value.startswith('"'):
            value = re.sub(r"\\(.)", r"\1", value[1:-1])
        parameters[name.lower()] = value
    return match[1].lower(), parameters


def _limit_for(raw_path: str) -> int:
    lowered = raw_path.lower()
    if any(lowered == route or lowered.startswith(route + "/") for route in _PHOTO_ROUTES):
        return RECEIPT_BODY_LIMIT
    return BODY_LIMIT


def _decoder(encoding: str) -> Any:
    if encoding == "gzip":
        return zlib.decompressobj(16 + zlib.MAX_WBITS)
    if encoding == "deflate":
        return zlib.decompressobj()
    if encoding == "br":
        return brotli.Decompressor()
    raise _BodyError(415, _UNREADABLE)


# The utf-* charsets iconv-lite knows, by their Python codec.
_CODECS: Final = {
    "utf-8": "utf-8",
    "utf-7": "utf-7",
    "utf-16": "utf-16",
    "utf-16le": "utf-16-le",
    "utf-16be": "utf-16-be",
    "utf-32": "utf-32",
    "utf-32le": "utf-32-le",
    "utf-32be": "utf-32-be",
}


def _text_codec(charset: str) -> str:
    """The charset's Python codec. body-parser takes only utf-* charsets for JSON, and only ones iconv knows."""
    codec = _CODECS.get(charset) if charset.startswith("utf-") else None
    if codec is None:
        raise _BodyError(415, _UNREADABLE)
    return codec


class BodyParser:
    """`express.json()`: parse a JSON body into scope["state"]["body"] (MISSING when there is none)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        state: dict[str, Any] = scope.setdefault("state", {})
        state["body"] = MISSING
        headers = Headers(scope=scope)
        length_header = headers.get("content-length")
        has_body = "transfer-encoding" in headers or (length_header is not None and length_header.strip().isdigit())
        media = _content_type(headers.get("content-type"))
        # Only requests that get past the parser reach the request log, as in app.ts.
        if not has_body or media is None or media[0] != "application/json":
            state["logged"] = True
            await self.app(scope, receive, send)
            return
        try:
            state["body"] = await self._read(scope, receive, headers, media[1])
        except _BodyError as error:
            message = {413: _TOO_LARGE}.get(error.status, error.message)
            await error_response(error.status, "VALIDATION_ERROR", message)(scope, receive, send)
            return

        async def empty() -> Message:
            return {"type": "http.request", "body": b"", "more_body": False}

        state["logged"] = True
        await self.app(scope, empty, send)

    async def _read(self, scope: Scope, receive: Receive, headers: Headers, parameters: dict[str, str]) -> object:
        codec = _text_codec(parameters.get("charset", "utf-8").lower())
        limit = _limit_for(scope.get("raw_path", scope["path"].encode()).decode("latin-1").split("?")[0])
        encoding = (headers.get("content-encoding") or "identity").lower()
        decoder = None if encoding == "identity" else _decoder(encoding)
        if decoder is None and int(headers.get("content-length") or 0) > limit:
            raise _BodyError(413, _TOO_LARGE)
        body = bytearray()
        more = True
        while more:
            message = await receive()
            if message["type"] == "http.disconnect":
                raise _BodyError(400, _UNREADABLE)
            chunk: bytes = message.get("body", b"")
            more = message.get("more_body", False)
            if decoder is not None:
                try:
                    chunk = (
                        decoder.process(chunk)
                        if isinstance(decoder, brotli.Decompressor)
                        else decoder.decompress(chunk)
                    )
                except (zlib.error, brotli.error) as error:
                    raise _BodyError(400, _UNREADABLE) from error
            body += chunk
            if len(body) > limit:
                raise _BodyError(413, _TOO_LARGE)
        if decoder is not None and not _finished(decoder):
            raise _BodyError(400, _UNREADABLE)
        text = bytes(body).decode(codec, errors="replace").removeprefix("﻿")
        if text == "":
            # A common client mistake, which body-parser reads as an empty object.
            return {}
        first = _JSON_FIRST.match(text)
        if first is None or first[1] not in "{[":
            raise _BodyError(400, _NOT_JSON)
        try:
            return json_parse(text)
        except ValueError as error:
            raise _BodyError(400, _NOT_JSON) from error


def _finished(decoder: Any) -> bool:
    if isinstance(decoder, brotli.Decompressor):
        return decoder.is_finished()
    return bool(decoder.eof)


class RequestLog:
    """One line of JSON per request: method, route, status and duration, never bodies or headers.

    It sits outside ExpressSend so it logs the status the client gets (a 304, say), but, as in app.ts, only
    requests the body parser let through are logged."""

    def __init__(self, app: ASGIApp, enabled: bool | None = None) -> None:
        self.app = app
        self.enabled = not env.is_test if enabled is None else enabled

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self.enabled:
            await self.app(scope, receive, send)
            return
        start = time.perf_counter_ns()
        status = 0

        async def logged(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)
            finished = message["type"] == "http.response.body" and not message.get("more_body", False)
            if finished and scope.get("state", {}).get("logged"):
                route = scope.get("raw_path", scope["path"].encode()).decode("latin-1").split("?")[0]
                line = {"method": scope["method"], "route": route, "status": status}
                line["ms"] = (time.perf_counter_ns() - start) // 1_000_000
                sys.stdout.write(json_stringify(line) + "\n")
                sys.stdout.flush()

        await self.app(scope, receive, logged)
