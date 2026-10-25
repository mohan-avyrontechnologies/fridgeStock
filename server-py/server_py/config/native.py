"""The addresses the Android and iOS apps call the API from (server/src/config/native.ts).

A Capacitor app is a web page served from the phone itself: on iOS from capacitor://localhost, on Android from
https://localhost. They are always allowed, next to the web app's own address (CLIENT_ORIGIN).
"""

from typing import Final

NATIVE_APP_ORIGINS: Final = ("capacitor://localhost", "https://localhost")
