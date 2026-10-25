"""bcrypt at cost 12 (server/src/services/passwordHash.ts). Plaintext passwords are never stored, logged or
returned.

The hashes are the ones Node's bcrypt writes ($2b$12$...), so either server can check a password the other one
stored. Node's bcrypt uses only the first 72 bytes of a password and Python's refuses longer ones, so the bytes
are cut the same way here. Hashing takes a quarter of a second, so it runs in a worker thread.
"""

import asyncio
from typing import Final

import bcrypt

from server_py.shared.js import utf8

BCRYPT_COST: Final = 12
_MAX_BYTES: Final = 72


def _password_bytes(password: str) -> bytes:
    return utf8(password)[:_MAX_BYTES]


async def hash_password(password: str) -> str:
    salt = bcrypt.gensalt(BCRYPT_COST)
    hashed = await asyncio.to_thread(bcrypt.hashpw, _password_bytes(password), salt)
    return hashed.decode("ascii")


def _check(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_password_bytes(password), hashed.encode("utf-8"))
    except ValueError:
        # Not a bcrypt hash at all: Node's bcrypt answers false too.
        return False


async def verify_password(password: str, hashed: str) -> bool:
    return await asyncio.to_thread(_check, password, hashed)
