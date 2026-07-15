#!/bin/sh
set -eu

RUNTIME_VENV="${DITING_RUNTIME_VENV:-$HOME/.local/share/diting-agent/venv}"
RUNTIME_ROOT="${DITING_RUNTIME_ROOT:-$HOME/.local/share/diting-agent/runtime}"

export DiTing_HOME="${DiTing_HOME:-$HOME/.diting}"
export DiTing_AGENT_ROOT="${DiTing_AGENT_ROOT:-$RUNTIME_ROOT}"
export PYTHONPATH="$RUNTIME_ROOT${PYTHONPATH:+:$PYTHONPATH}"

exec "$RUNTIME_VENV/bin/python" -m diting_cli.main "$@"
