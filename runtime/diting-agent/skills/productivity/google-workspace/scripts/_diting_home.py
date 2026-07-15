"""Resolve DiTing_HOME for standalone skill scripts.

Skill scripts may run outside the DiTing process (e.g. system Python,
nix env, CI) where ``diting_constants`` is not importable.  This module
provides the same ``get_diting_home()`` and ``display_diting_home()``
contracts as ``diting_constants`` without requiring it on ``sys.path``.

When ``diting_constants`` IS available it is used directly so that any
future enhancements (profile resolution, Docker detection, etc.) are
picked up automatically.  The fallback path replicates the core logic
from ``diting_constants.py`` using only the stdlib.

All scripts under ``google-workspace/scripts/`` should import from here
instead of duplicating the ``DiTing_HOME = Path(os.getenv(...))`` pattern.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from diting_constants import display_diting_home as display_diting_home
    from diting_constants import get_diting_home as get_diting_home
except (ModuleNotFoundError, ImportError):

    def get_diting_home() -> Path:
        """Return the DiTing home directory (default: ~/.diting).

        Mirrors ``diting_constants.get_diting_home()``."""
        val = os.environ.get("DiTing_HOME", "").strip()
        return Path(val) if val else Path.home() / ".diting"

    def display_diting_home() -> str:
        """Return a user-friendly ``~/``-shortened display string.

        Mirrors ``diting_constants.display_diting_home()``."""
        home = get_diting_home()
        try:
            return "~/" + str(home.relative_to(Path.home()))
        except ValueError:
            return str(home)
