"""scripts/dev-mongo.mjs, started from Python: the local MongoDB for development and tests.

Closing its standard input stops it (and deletes an empty one's folder); that is how it is stopped on Windows,
where a killed process gets no chance to clean up.
"""

import json
import subprocess
from pathlib import Path
from typing import Final

SERVER_PY: Final = Path(__file__).resolve().parents[1]
DEV_MONGO: Final = SERVER_PY / "scripts" / "dev-mongo.mjs"


class EmbeddedMongo:
    def __init__(self, args: list[str] | None = None) -> None:
        """With no arguments, the empty mode (--empty); with a list (even an empty one), the persistent mode with
        those options (--data-dir, --port)."""
        self.process = subprocess.Popen(
            ["node", str(DEV_MONGO), *(args if args is not None else ["--empty"])],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )
        assert self.process.stdout is not None
        ready = json.loads(self.process.stdout.readline())
        self.uri: str = ready["uri"]
        self.db_path = Path(ready["dbPath"])

    def stop(self) -> None:
        assert self.process.stdin is not None
        self.process.stdin.close()
        self.process.wait(timeout=60)
