"""Rate limits per IP address, as express-rate-limit 8 gives them in server/src/routes/index.ts.

Each limiter keeps its own count per client in memory: a fixed window that starts with the client's first request
and lasts `window_ms`. Every request it sees (allowed or not) carries the IETF draft-8 headers:

    RateLimit: "20-in-15min"; r=19; t=900
    RateLimit-Policy: "20-in-15min"; q=20; w=900; pk=:<hash of the client's key>:

and one over the limit gets a 429 with Retry-After. AUTH_RATE_LIMIT=off turns every limiter off (the tests do,
except the ones that check a limit).

The client is the address one proxy hop in front of the server (Express's `trust proxy` = 1): the last entry of
X-Forwarded-For, else the connection's address. IPv6 addresses count per /56 network.
"""

import base64
import hashlib
import ipaddress
import math
import os
from dataclasses import dataclass, field
from typing import Final

from starlette.requests import Request
from starlette.responses import Response

from server_py.middleware.http import json_response, response_headers
from server_py.services import clock
from server_py.shared.js import number_text

_IPV4_COMPATIBLE: Final = ipaddress.IPv6Network("::/96")


def client_ip(request: Request) -> str:
    """`req.ip` with `trust proxy` set to 1."""
    forwarded = ", ".join(request.headers.getlist("x-forwarded-for"))
    entries = [entry.strip(" ") for entry in forwarded.split(",") if entry.strip(" ")] if forwarded else []
    if entries:
        return entries[-1]
    return request.client.host if request.client else ""


def ip_key(ip: str) -> str:
    """express-rate-limit's ipKeyGenerator: IPv4 as it is, IPv4-mapped IPv6 as IPv4, other IPv6 as its /56."""
    try:
        address = ipaddress.ip_address(ip.split("%")[0])
    except ValueError:
        return ip
    if isinstance(address, ipaddress.IPv4Address):
        return ip
    if address.ipv4_mapped is not None:
        return str(address.ipv4_mapped)
    if "." in ip and address in _IPV4_COMPATIBLE:
        return str(ipaddress.IPv4Address(int(address)))
    return str(ipaddress.IPv6Network(f"{address}/56", strict=False))


def _partition_key(key: str) -> str:
    return base64.b64encode(hashlib.sha256(key.encode("utf-8")).hexdigest()[:12].encode("ascii")).decode("ascii")


def _window_text(window_ms: int) -> str:
    """The policy name's window, as express-rate-limit writes it ("30sec", "15min", "2hrs", "1day")."""
    seconds = window_ms / 1000
    if seconds < 60:
        return f"{number_text(seconds)}sec"
    if (minutes := seconds / 60) < 60:
        return f"{number_text(minutes)}min"
    if (hours := minutes / 60) < 24:
        return f"{number_text(hours)}hr{'s' if hours > 1 else ''}"
    days = hours / 24
    return f"{number_text(days)}day{'s' if days > 1 else ''}"


@dataclass
class _Client:
    hits: int
    reset_at: float


@dataclass
class RateLimit:
    window_ms: int
    limit: int
    message: str
    _clients: dict[str, _Client] = field(default_factory=dict[str, _Client])

    @property
    def name(self) -> str:
        return f"{self.limit}-in-{_window_text(self.window_ms)}"

    def reset(self) -> None:
        self._clients.clear()

    def _hit(self, key: str, now_ms: float) -> _Client:
        client = self._clients.get(key)
        if client is None or client.reset_at <= now_ms:
            # Forget windows that are over, as the memory store's sweep does.
            self._clients = {k: c for k, c in self._clients.items() if c.reset_at > now_ms}
            client = self._clients[key] = _Client(0, now_ms + self.window_ms)
        client.hits += 1
        return client

    async def __call__(self, request: Request) -> Response | None:
        if os.environ.get("AUTH_RATE_LIMIT") == "off":
            return None
        key = ip_key(client_ip(request))
        now_ms = clock.system_now().timestamp() * 1000
        client = self._hit(key, now_ms)
        remaining = max(self.limit - client.hits, 0)
        reset_seconds = max(0, math.ceil((client.reset_at - now_ms) / 1000))
        window_seconds = math.ceil(self.window_ms / 1000)
        headers = response_headers(request)
        headers["ratelimit"] = f'"{self.name}"; r={remaining}; t={reset_seconds}'
        headers["ratelimit-policy"] = f'"{self.name}"; q={self.limit}; w={window_seconds}; pk=:{_partition_key(key)}:'
        if client.hits > self.limit:
            headers["retry-after"] = str(reset_seconds)
            return json_response(429, {"error": {"code": "RATE_LIMITED", "message": self.message}})
        return None
