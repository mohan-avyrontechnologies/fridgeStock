"""HTTP behaviour the TypeScript server gets from Express, helmet, cors, body-parser and express-rate-limit.

Every expected value here (headers, ETags, statuses, messages) was recorded from the Node server itself, so the
two servers answer byte for byte alike.
"""

import gzip
import json
import zlib

import brotli
import httpx
import pytest

from server_py.middleware.http import HELMET_HEADERS, RequestLog, weak_etag
from server_py.middleware.rate_limit import client_ip, ip_key
from tests.conftest import register_user

pytestmark = pytest.mark.phase1

JSON = {"Content-Type": "application/json"}
NOT_JSON = {"error": {"code": "VALIDATION_ERROR", "message": "Request body is not valid JSON."}}
UNREADABLE = {"error": {"code": "VALIDATION_ERROR", "message": "The request body couldn't be read."}}
TOO_LARGE = {"error": {"code": "VALIDATION_ERROR", "message": "That request is too large."}}
NEEDS_EMAIL = {"error": {"code": "VALIDATION_ERROR", "message": "Enter a valid email address.", "field": "email"}}


class TestResponses:
    async def test_health_is_sent_as_express_sends_it(self, api: httpx.AsyncClient) -> None:
        res = await api.get("/api/health")
        assert res.status_code == 200
        assert res.content == b'{"ok":true}'
        assert res.headers["content-type"] == "application/json; charset=utf-8"
        assert res.headers["content-length"] == "11"
        assert res.headers["etag"] == 'W/"b-Ai2R8hgEarLmHKwesT1qcY913ys"'
        assert res.headers["vary"] == "Origin"
        for name, value in HELMET_HEADERS:
            assert res.headers[name] == value
        assert "x-powered-by" not in res.headers

    async def test_errors_carry_the_same_etag_as_node(self, api: httpx.AsyncClient) -> None:
        not_found = await api.get("/nope")
        assert not_found.status_code == 404
        assert not_found.content == b'{"error":{"code":"NOT_FOUND","message":"Route not found."}}'
        assert not_found.headers["etag"] == 'W/"3b-H04Se/s4qOSaN0eWcZu+cgc8PSI"'
        unauthenticated = await api.get("/api/nope")
        assert unauthenticated.status_code == 401
        assert unauthenticated.headers["etag"] == 'W/"49-QAHfpoRFWWkRR2KLjvxWy3VLLvc"'

    async def test_head_has_the_headers_of_get_and_no_body(self, api: httpx.AsyncClient) -> None:
        res = await api.head("/api/health")
        assert res.status_code == 200
        assert res.content == b""
        assert res.headers["content-length"] == "11"
        assert res.headers["etag"] == 'W/"b-Ai2R8hgEarLmHKwesT1qcY913ys"'

    async def test_a_matching_if_none_match_is_a_304_with_no_body(self, api: httpx.AsyncClient) -> None:
        etag = 'W/"b-Ai2R8hgEarLmHKwesT1qcY913ys"'
        res = await api.get("/api/health", headers={"If-None-Match": etag})
        assert res.status_code == 304
        assert res.content == b""
        assert "content-type" not in res.headers
        assert "content-length" not in res.headers
        assert (await api.get("/api/health", headers={"If-None-Match": '"other"'})).status_code == 200
        assert (
            await api.get("/api/health", headers={"If-None-Match": etag, "Cache-Control": "no-cache"})
        ).status_code == 200
        # Errors are never "not modified".
        assert (
            await api.get("/nope", headers={"If-None-Match": 'W/"3b-H04Se/s4qOSaN0eWcZu+cgc8PSI"'})
        ).status_code == 404

    def test_weak_etag_matches_the_etag_package(self) -> None:
        assert weak_etag(b"") == 'W/"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"'


class TestRouting:
    async def test_paths_match_without_case_and_with_a_trailing_slash(self, api: httpx.AsyncClient) -> None:
        assert (await api.get("/API/Health/")).json() == {"ok": True}
        assert (await api.get("/api/health?x=1")).json() == {"ok": True}

    async def test_an_encoded_or_doubled_path_is_not_the_route(self, api: httpx.AsyncClient) -> None:
        assert (await api.get("/api/heal%74h")).status_code == 401
        assert (await api.get("/api//health")).status_code == 401

    async def test_a_wrong_method_or_unknown_path_under_api_needs_a_login_first(self, api: httpx.AsyncClient) -> None:
        for method, path in [("POST", "/api/health"), ("GET", "/api/auth/login"), ("DELETE", "/api/health")]:
            res = await api.request(method, path)
            assert res.status_code == 401
            assert res.json() == {"error": {"code": "UNAUTHENTICATED", "message": "Authentication required."}}
        account = await register_user(api)
        res = await api.get("/api/auth/login", headers=account.headers)
        assert res.status_code == 404
        assert res.json() == {"error": {"code": "NOT_FOUND", "message": "Route not found."}}

    async def test_outside_api_everything_is_route_not_found(self, api: httpx.AsyncClient) -> None:
        for path in ["/", "/apix/health", "/docs", "/openapi.json"]:
            res = await api.get(path)
            assert res.status_code == 404, path
            assert res.json() == {"error": {"code": "NOT_FOUND", "message": "Route not found."}}

    async def test_the_scheme_must_be_bearer_with_one_space(self, api: httpx.AsyncClient) -> None:
        account = await register_user(api)
        assert (await api.get("/api/auth/me", headers={"Authorization": f"bearer {account.token}"})).status_code == 401
        assert (await api.get("/api/auth/me", headers={"Authorization": f"Bearer  {account.token}"})).status_code == 401
        # Anything after the token is ignored, as `split(' ')` ignores it.
        assert (
            await api.get("/api/auth/me", headers={"Authorization": f"Bearer {account.token} x"})
        ).status_code == 200


class TestCors:
    async def test_allowed_origins_get_access_control_allow_origin(self, api: httpx.AsyncClient) -> None:
        for origin in ["http://localhost:5173", "capacitor://localhost", "https://localhost"]:
            res = await api.get("/api/health", headers={"Origin": origin})
            assert res.headers["access-control-allow-origin"] == origin
            assert res.headers["vary"] == "Origin"
        other = await api.get("/api/health", headers={"Origin": "http://evil.com"})
        assert "access-control-allow-origin" not in other.headers
        assert other.headers["vary"] == "Origin"

    async def test_every_options_request_is_answered_as_a_preflight(self, api: httpx.AsyncClient) -> None:
        res = await api.options(
            "/api/foods",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        assert res.status_code == 204
        assert res.headers["access-control-allow-origin"] == "http://localhost:5173"
        assert res.headers["access-control-allow-methods"] == "GET,HEAD,PUT,PATCH,POST,DELETE"
        assert res.headers["access-control-allow-headers"] == "authorization,content-type"
        assert res.headers["vary"] == "Origin, Access-Control-Request-Headers"
        assert res.headers["content-length"] == "0"
        assert res.headers["x-frame-options"] == "SAMEORIGIN"
        other = await api.options("/whatever", headers={"Origin": "http://evil.com"})
        assert other.status_code == 204
        assert "access-control-allow-origin" not in other.headers
        assert "access-control-allow-headers" not in other.headers
        assert other.headers["vary"] == "Origin, Access-Control-Request-Headers"


class TestBodies:
    async def login(self, api: httpx.AsyncClient, body: bytes, **headers: str) -> httpx.Response:
        return await api.post("/api/auth/login", content=body, headers={**JSON, **headers})

    async def test_bodies_that_arent_json_objects_or_arrays_are_refused(self, api: httpx.AsyncClient) -> None:
        for body in [b"{bad", b'"x"', b'{"email":NaN}', b"null", b"5", b"\xef\xbb\xbf{bad"]:
            res = await self.login(api, body)
            assert res.status_code == 400, body
            assert res.json() == NOT_JSON
        # The same before routing, on a path that doesn't exist.
        assert (await api.post("/nope", content=b"{bad", headers=JSON)).json() == NOT_JSON

    async def test_an_array_is_parsed_and_refused_by_the_schema(self, api: httpx.AsyncClient) -> None:
        res = await self.login(api, b"[]")
        assert res.status_code == 400
        assert res.json() == {
            "error": {"code": "VALIDATION_ERROR", "message": "Invalid input: expected object, received array"}
        }

    async def test_an_empty_json_body_or_one_of_another_type_is_an_empty_object(self, api: httpx.AsyncClient) -> None:
        assert (await self.login(api, b"")).json() == NEEDS_EMAIL
        assert (await self.login(api, b"  \n {}")).json() == NEEDS_EMAIL
        for content_type in [
            "application/x-www-form-urlencoded",
            "text/plain",
            "application/vnd.api+json",
            "application/json;;",
        ]:
            res = await api.post("/api/auth/login", content=b'{"email":"a"}', headers={"Content-Type": content_type})
            assert res.json() == NEEDS_EMAIL, content_type

    async def test_charsets(self, api: httpx.AsyncClient) -> None:
        latin = await api.post(
            "/api/auth/login", content=b'{"email":"a"}', headers={"Content-Type": "application/json; charset=latin1"}
        )
        assert latin.status_code == 415
        assert latin.json() == UNREADABLE
        utf16 = await api.post(
            "/api/auth/login", content=b'{"email":"a"}', headers={"Content-Type": "application/json; charset=utf-16"}
        )
        assert utf16.status_code == 400
        assert utf16.json() == NOT_JSON
        upper = await api.post(
            "/api/auth/login", content=b'{"email":"a"}', headers={"Content-Type": "application/json; charset=UTF-8"}
        )
        assert upper.json() == NEEDS_EMAIL

    async def test_the_20_kb_limit(self, api: httpx.AsyncClient) -> None:
        exact = json.dumps({"e": "a" * (20480 - 8)}, separators=(",", ":")).encode()
        assert len(exact) == 20480
        assert (await self.login(api, exact)).json() == NEEDS_EMAIL
        over = await self.login(api, json.dumps({"email": "a" * 21000}).encode())
        assert over.status_code == 413
        assert over.json() == TOO_LARGE
        assert (await api.post("/nope", content=b"{" + b" " * 21000 + b"}", headers=JSON)).status_code == 413

    async def test_compressed_bodies(self, api: httpx.AsyncClient) -> None:
        body = b'{"email":"x"}'
        for encoding, data in [
            ("gzip", gzip.compress(body)),
            ("deflate", zlib.compress(body)),
            ("br", brotli.compress(body)),
            ("GZIP", gzip.compress(body)),
            ("identity", body),
        ]:
            res = await self.login(api, data, **{"Content-Encoding": encoding})
            assert res.json() == NEEDS_EMAIL, encoding
        bomb = await self.login(
            api, gzip.compress(json.dumps({"e": "a" * 30000}).encode()), **{"Content-Encoding": "gzip"}
        )
        assert bomb.status_code == 413
        assert bomb.json() == TOO_LARGE
        unknown = await self.login(api, body, **{"Content-Encoding": "zstd-x"})
        assert (unknown.status_code, unknown.json()) == (415, UNREADABLE)
        corrupt = await self.login(api, b"notgzip", **{"Content-Encoding": "gzip"})
        assert (corrupt.status_code, corrupt.json()) == (400, UNREADABLE)


class TestRateLimit:
    @pytest.fixture(autouse=True)
    def limits_on(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("AUTH_RATE_LIMIT")

    async def test_the_auth_limit_and_its_draft_8_headers(self, api: httpx.AsyncClient) -> None:
        first = await api.post("/api/auth/register", json={})
        assert first.status_code == 400
        assert first.headers["ratelimit"] == '"20-in-15min"; r=19; t=900'
        assert first.headers["ratelimit-policy"] == '"20-in-15min"; q=20; w=900; pk=:MTJjYTE3YjQ5YWYy:'
        # Register and login share one count.
        for _ in range(18):
            await api.post("/api/auth/login", json={})
        last = await api.post("/api/auth/login", json={})
        assert last.status_code == 400
        assert last.headers["ratelimit"].startswith('"20-in-15min"; r=0; t=')
        blocked = await api.post("/api/auth/register", json={})
        assert blocked.status_code == 429
        assert blocked.json() == {"error": {"code": "RATE_LIMITED", "message": "Too many attempts. Try again later."}}
        assert int(blocked.headers["retry-after"]) in (899, 900)
        # A body the parser refuses never reaches the limiter, so it isn't counted or limited.
        assert (await api.post("/api/auth/login", content=b"{bad", headers=JSON)).status_code == 400

    async def test_the_client_is_the_last_forwarded_address(self, api: httpx.AsyncClient) -> None:
        res = await api.post("/api/auth/register", json={}, headers={"X-Forwarded-For": "9.9.9.9, 1.2.3.4"})
        assert res.headers["ratelimit-policy"] == '"20-in-15min"; q=20; w=900; pk=:NjY5NGY4M2M5ZjQ3:'
        assert res.headers["ratelimit"] == '"20-in-15min"; r=19; t=900'

    async def test_other_routes_have_no_limit_headers(self, api: httpx.AsyncClient) -> None:
        assert "ratelimit" not in (await api.get("/api/health")).headers

    def test_ip_keys_match_express_rate_limit(self) -> None:
        # Recorded from express-rate-limit's ipKeyGenerator.
        assert ip_key("2001:db8:abcd:12ff::1") == "2001:db8:abcd:1200::/56"
        assert ip_key("::1") == "::/56"
        assert ip_key("::ffff:1.2.3.4") == "1.2.3.4"
        assert ip_key("::1.2.3.4") == "1.2.3.4"
        assert ip_key("fe80::1%eth0") == "fe80::/56"
        assert ip_key("2001:DB8::1") == "2001:db8::/56"
        assert ip_key("1.2.3.4") == "1.2.3.4"
        assert ip_key("garbage") == "garbage"

    def test_client_ip_reads_one_proxy_hop(self) -> None:
        from starlette.requests import Request

        def request(*forwarded: str) -> Request:
            headers = [(b"x-forwarded-for", value.encode()) for value in forwarded]
            return Request({"type": "http", "headers": headers, "client": ("10.0.0.1", 1)})

        assert client_ip(request()) == "10.0.0.1"
        assert client_ip(request("1.2.3.4")) == "1.2.3.4"
        assert client_ip(request("1.1.1.1, 2.2.2.2")) == "2.2.2.2"
        assert client_ip(request("1.1.1.1", "3.3.3.3")) == "3.3.3.3"


class TestRequestLog:
    async def test_one_line_per_request_with_no_body_or_headers(self, capsys: pytest.CaptureFixture[str]) -> None:
        lines: list[str] = []

        async def app(scope: object, receive: object, send: object) -> None:
            await send({"type": "http.response.start", "status": 201, "headers": []})  # pyright: ignore[reportCallIssue]
            await send({"type": "http.response.body", "body": b"{}"})  # pyright: ignore[reportCallIssue]

        async def send(message: object) -> None:
            lines.append(str(message))

        log = RequestLog(app, enabled=True)  # pyright: ignore[reportArgumentType]
        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/auth/login",
            "raw_path": b"/api/auth/login?x=1",
            "state": {"logged": True},
        }
        await log(scope, None, send)  # pyright: ignore[reportArgumentType]
        line = json.loads(capsys.readouterr().out)
        assert list(line) == ["method", "route", "status", "ms"]
        assert line["method"] == "POST"
        assert line["route"] == "/api/auth/login"
        assert line["status"] == 201
