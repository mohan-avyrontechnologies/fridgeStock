"""Run the API: `python -m server_py` (or `npm run dev:server-py`, which adds --reload).

It listens on PORT (4000 by default, like the TypeScript server; set PORT=4001 in server-py/.env to run both).
Uvicorn's own proxy handling and Server header are off: the app reads X-Forwarded-For itself, trusting one
proxy hop as Express's `trust proxy` = 1 does, and Express sends no Server header.
"""

import argparse

import uvicorn

from server_py.config.env import env


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m server_py")
    parser.add_argument("--host", default="0.0.0.0", help="address to listen on (default: every address)")
    parser.add_argument("--reload", action="store_true", help="restart when the code changes (development)")
    options = parser.parse_args()
    uvicorn.run(
        "server_py.main:app",
        host=options.host,
        port=env.port,
        reload=options.reload,
        proxy_headers=False,
        server_header=False,
        # The app logs each request itself (method, route, status, time), as the TypeScript server does.
        access_log=False,
        workers=1,
    )


if __name__ == "__main__":
    main()
