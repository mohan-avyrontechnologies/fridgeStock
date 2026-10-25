"""Favourite foods for one-tap re-adding (server/src/models/Favourite.ts)."""

from server_py.models.base import Model, index

FAVOURITE = Model("Favourite", "favourites", (index(("userId", 1), ("nameKey", 1), unique=True),))
