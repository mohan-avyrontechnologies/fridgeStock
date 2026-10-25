"""Routes and architecture rules, checked against the source itself (server/src/tests/security.test.ts's route
walk and the route and layer parts of structure.test.ts).

Until Phase 6 the Python server has only some of the routes, so docs/API.md is checked as an ordered superset:
every route the server registers is documented, in the same order. Phase 6 makes it an exact match.
"""

import re
from pathlib import Path

import httpx
import pytest

from server_py.routes.index import router

pytestmark = pytest.mark.phase1

REPO = Path(__file__).resolve().parents[2]
SRC = REPO / "server-py" / "server_py"
PUBLIC = [("GET", "/health"), ("POST", "/auth/register"), ("POST", "/auth/login"), ("POST", "/push/actions")]


def documented_routes() -> list[tuple[str, str]]:
    text = (REPO / "docs" / "API.md").read_text(encoding="utf-8")
    return [(m[1], m[2]) for m in re.finditer(r"^\| (GET|POST|PUT|DELETE) \| `([^`]+)`", text, re.MULTILINE)]


def sample(path: str) -> str:
    """The path with a made-up value for each :param."""
    return re.sub(r":[a-z]+", lambda m: "2026-09-30" if m[0] == ":date" else "abc", path, flags=re.IGNORECASE)


def test_every_registered_route_is_documented_in_the_same_order() -> None:
    documented = documented_routes()
    assert len(documented) == 68
    registered = router.registered()
    positions = [documented.index(route) for route in registered if route in documented]
    assert [route for route in registered if route not in documented] == []
    assert positions == sorted(positions)


def test_the_phase_1_routes_are_registered() -> None:
    assert router.registered() == [
        ("GET", "/health"),
        ("POST", "/auth/register"),
        ("POST", "/auth/login"),
        ("GET", "/auth/me"),
        ("PUT", "/auth/me"),
        ("GET", "/push/config"),
        ("GET", "/ai/status"),
    ]


@pytest.mark.parametrize(("method", "path"), [r for r in router.registered() if r not in PUBLIC])
async def test_every_other_route_is_a_401_without_a_token_and_with_a_bad_one(
    api: httpx.AsyncClient, method: str, path: str
) -> None:
    missing = await api.request(method, f"/api{sample(path)}")
    assert missing.status_code == 401
    assert missing.json()["error"]["code"] == "UNAUTHENTICATED"
    bad = await api.request(method, f"/api{sample(path)}", headers={"Authorization": "Bearer not-a-token"})
    assert bad.status_code == 401


@pytest.mark.parametrize(("method", "path"), [r for r in PUBLIC if r in router.registered()])
async def test_public_routes_answer_without_a_token(api: httpx.AsyncClient, method: str, path: str) -> None:
    res = await api.request(method, f"/api{sample(path)}")
    assert res.status_code != 401


def _python_files(folder: str) -> list[Path]:
    return sorted((SRC / folder).rglob("*.py"))


def _imports(file: Path) -> list[str]:
    return re.findall(r"^(?:from|import) ([\w.]+)", file.read_text(encoding="utf-8"), re.MULTILINE)


def test_controllers_are_thin_they_never_import_models_pymongo_or_another_controller() -> None:
    for file in _python_files("controllers"):
        for name in _imports(file):
            assert not re.match(r"server_py\.models|pymongo|bson|server_py\.controllers", name), (file.name, name)


def test_controllers_contain_no_business_logic() -> None:
    for file in _python_files("controllers"):
        code = re.sub(r'"""[\s\S]*?"""|#.*', "", file.read_text(encoding="utf-8"))
        assert not re.search(r"\bif\b|\bfor\b|\bwhile\b|\braise\b|\.find|\.save", code), file.name


def test_routes_only_wire_paths_to_middleware_and_controllers() -> None:
    for name in _imports(SRC / "routes" / "index.py"):
        assert not re.match(r"server_py\.(models|services)|pymongo", name), name


def test_only_models_and_db_py_talk_to_mongodb() -> None:
    for file in sorted(SRC.rglob("*.py")):
        relative = file.relative_to(SRC).as_posix()
        if relative.startswith("models/") or relative == "db.py":
            continue
        code = re.sub(r'"""[\s\S]*?"""|#.*', "", file.read_text(encoding="utf-8"))
        for name in _imports(file):
            assert not name.startswith("pymongo.asynchronous"), (relative, name)
        assert ".collection()" not in code, relative
        assert "db.database()" not in code, relative


def test_only_the_clock_reads_the_time() -> None:
    offenders: list[str] = []
    for file in sorted(SRC.rglob("*.py")):
        relative = file.relative_to(SRC).as_posix()
        if relative in ("services/clock.py", "shared/dates.py"):
            continue
        code = re.sub(r'"""[\s\S]*?"""|#.*', "", file.read_text(encoding="utf-8"))
        if re.search(r"datetime\.now\(|datetime\.utcnow\(|time\.time\(|date\.today\(", code):
            offenders.append(relative)
    assert offenders == []
