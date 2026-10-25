"""Login tokens and passwords work across both servers (docs/PYTHON_MIGRATION.md §4, "Logins and tokens").

Node is run for real here: `jsonwebtoken` signs and checks tokens with the same secret, so a token from either
server is accepted by the other, and the bcrypt hashes come from Node's bcrypt.
"""

import json
import subprocess
from datetime import UTC, datetime

import pytest

from server_py.config.env import env
from server_py.services import clock, token
from server_py.services.password_hash import hash_password, verify_password
from tests.conftest import SERVER_PY

pytestmark = pytest.mark.phase1

USER_ID = "6ade2fa5351af17b8691c1cc"


def node(script: str, *args: str) -> object:
    """Run a script with the repository's npm packages; it prints one JSON value."""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, *args],
        cwd=SERVER_PY.parent / "server",
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def test_a_token_is_byte_for_byte_what_jsonwebtoken_signs(monkeypatch: pytest.MonkeyPatch) -> None:
    issued = datetime(2026, 10, 25, 16, 34, 45, tzinfo=UTC)
    monkeypatch.setattr(clock, "system_now", lambda: issued)
    ours = token.sign_token(USER_ID)
    theirs = node(
        "import jwt from 'jsonwebtoken';"
        "const [secret, sub, iat] = process.argv.slice(1);"
        "const options = { algorithm: 'HS256', subject: sub, expiresIn: '7d' };"
        "console.log(JSON.stringify(jwt.sign({ iat: Number(iat) }, secret, options)));",
        env.jwt_secret,
        USER_ID,
        str(int(issued.timestamp())),
    )
    assert ours == theirs


def test_node_accepts_a_python_token_and_python_a_node_one() -> None:
    ours = token.sign_token(USER_ID)
    checked = node(
        "import jwt from 'jsonwebtoken';"
        "const [secret, t] = process.argv.slice(1);"
        "console.log(JSON.stringify(jwt.verify(t, secret, { algorithms: ['HS256'] }).sub));",
        env.jwt_secret,
        ours,
    )
    assert checked == USER_ID
    theirs = node(
        "import jwt from 'jsonwebtoken';"
        "const [secret, sub] = process.argv.slice(1);"
        "console.log(JSON.stringify(jwt.sign({}, secret, { algorithm: 'HS256', subject: sub, expiresIn: '7d' })));",
        env.jwt_secret,
        USER_ID,
    )
    assert isinstance(theirs, str)
    assert token.verify_token(theirs) == USER_ID


def test_tokens_that_are_not_login_tokens_are_refused() -> None:
    action = token.sign_action_token(USER_ID, "food")
    assert token.verify_token(action) is None
    assert token.verify_action_token(action) is not None
    assert token.verify_meal_action_token(action) is None
    for bad in ["", "a.b", "a.b.c", f"{action}x", action.replace(".", "..", 1)]:
        assert token.verify_token(bad) is None


def test_action_tokens_follow_the_apps_clock() -> None:
    clock.set(datetime(2026, 9, 29, 12, tzinfo=UTC))
    try:
        signed = token.sign_meal_action_token(USER_ID, "dinner", "2026-09-29")
        claims = token.verify_meal_action_token(signed)
        assert claims is not None
        assert (claims["meal"], claims["date"], claims["userId"]) == ("dinner", "2026-09-29", USER_ID)
        assert claims["expiresAt"] == datetime(2026, 9, 30, 12, tzinfo=UTC)
        clock.set(datetime(2026, 9, 30, 12, tzinfo=UTC))
        assert token.verify_meal_action_token(signed) is None
    finally:
        clock.set(None)


@pytest.mark.parametrize(
    ("text", "milliseconds"),
    # Recorded from the ms package.
    [
        ("7d", 604800000),
        ("12h", 43200000),
        ("3600", 3600),
        ("1.5h", 5400000),
        (" 7d", None),
        ("7 d", 604800000),
        ("7D", 604800000),
        ("-1d", -86400000),
        (".5d", 43200000),
        ("7days", 604800000),
        ("1y", 31557600000),
        ("abc", None),
    ],
)
def test_jwt_expires_in_is_read_as_the_ms_package_reads_it(text: str, milliseconds: int | None) -> None:
    assert token.parse_ms(text) == milliseconds


def test_an_empty_jwt_expires_in_fails_as_in_node() -> None:
    with pytest.raises(ValueError, match="non-empty string"):
        token.parse_ms("")


# Hashed by Node's bcrypt at cost 12.
NODE_HASHES = [
    # 50 two-byte characters: 100 bytes, of which bcrypt reads 72.
    ("é" * 50, "$2b$12$vgiNmnD6TqLPlQgGtQsrjufbnfpqixqO6KFmcBaxw.fQJFGQAQ9VK"),
    ("pass\x00word1", "$2b$12$AadzljiXxFC9CeMYXXgfRehanEXxNEZdn8mkUoK3yJTTKsRkeUS2O"),
    ("ünïcode-pässwörd", "$2b$12$u4T/8.4bBAeoSOmWY.RJtu13vkIQAayU8Rrr5YkUbQVInXm4Tpbvm"),
]


@pytest.mark.parametrize(("password", "hashed"), NODE_HASHES)
async def test_passwords_hashed_by_node_are_accepted(password: str, hashed: str) -> None:
    assert await verify_password(password, hashed)
    assert not await verify_password(password + "x" if len(password) < 30 else "nope", hashed)


async def test_only_the_first_72_bytes_count_as_in_node() -> None:
    assert await verify_password("é" * 36, NODE_HASHES[0][1])
    assert not await verify_password("pass", NODE_HASHES[1][1])


async def test_new_hashes_are_cost_12_and_node_accepts_them() -> None:
    hashed = await hash_password("correct horse battery")
    assert hashed.startswith("$2b$12$")
    checked = node(
        "import bcrypt from 'bcrypt';"
        "const [pw, h] = process.argv.slice(1);"
        "console.log(JSON.stringify(await bcrypt.compare(pw, h)));",
        "correct horse battery",
        hashed,
    )
    assert checked is True


async def test_something_that_isnt_a_hash_never_matches() -> None:
    assert not await verify_password("x", "x")
