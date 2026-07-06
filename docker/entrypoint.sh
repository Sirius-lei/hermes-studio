#!/bin/sh
set -eu

log() {
  printf '[docker-entrypoint] %s\n' "$*" >&2
}

set_default_if_empty() {
  var_name="$1"
  default_value="$2"
  eval "current_value=\${$var_name:-}"
  if [ -z "$current_value" ]; then
    export "$var_name=$default_value"
  fi
}

find_first_executable() {
  for candidate in "$@"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

find_agent_root() {
  for candidate in \
    "${HERMES_AGENT_ROOT:-}" \
    /opt/hermes/hermes-agent \
    /opt/hermes-agent \
    /usr/local/lib/hermes-agent \
    "${HERMES_HOME}/hermes-agent"
  do
    if [ -n "$candidate" ] && [ -f "$candidate/run_agent.py" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

set_default_if_empty HOME /home/agent
set_default_if_empty PORT 6060
set_default_if_empty BIND_HOST 0.0.0.0
set_default_if_empty HERMES_HOME /home/agent/.hermes
set_default_if_empty HERMES_WEB_UI_HOME /home/agent/.hermes-web-ui
set_default_if_empty HERMES_WEB_UI_MANAGED_GATEWAY 1
set_default_if_empty HERMES_WEB_UI_REQUIRE_AGENT_BRIDGE 1
set_default_if_empty HERMES_AGENT_BRIDGE_ENDPOINT tcp://127.0.0.1:18765
set_default_if_empty HERMES_AGENT_BRIDGE_WORKER_TRANSPORT tcp
set_default_if_empty HERMES_AGENT_BRIDGE_WORKER_PORT_BASE 18780
set_default_if_empty HERMES_AGENT_BRIDGE_STARTUP_TIMEOUT_MS 120000
set_default_if_empty HERMES_AGENT_BRIDGE_WARM_PROFILES active
set_default_if_empty HERMES_AGENT_BRIDGE_WORKER_IDLE_TIMEOUT_SECONDS 86400
set_default_if_empty HERMES_AGENT_BRIDGE_SESSION_IDLE_TIMEOUT_SECONDS 86400
set_default_if_empty UPLOAD_DIR "${HERMES_WEB_UI_HOME}/upload"

if [ -z "${HERMES_BIN:-}" ]; then
  if hermes_bin="$(find_first_executable /opt/hermes/.venv/bin/hermes /usr/local/bin/hermes "$(command -v hermes 2>/dev/null || true)")"; then
    export HERMES_BIN="$hermes_bin"
  else
    log "warning: Hermes CLI binary not found in expected locations"
  fi
fi

if [ -z "${HERMES_AGENT_ROOT:-}" ]; then
  if agent_root="$(find_agent_root)"; then
    export HERMES_AGENT_ROOT="$agent_root"
  fi
fi

if [ -z "${HERMES_AGENT_BRIDGE_PYTHON:-}" ]; then
  if bridge_python="$(find_first_executable /opt/hermes/.venv/bin/python3 /opt/hermes/.venv/bin/python /usr/bin/python3 "$(command -v python3 2>/dev/null || true)" "$(command -v python 2>/dev/null || true)")"; then
    export HERMES_AGENT_BRIDGE_PYTHON="$bridge_python"
  else
    log "warning: no Python interpreter found for Hermes agent bridge"
  fi
fi

mkdir -p "$HERMES_HOME" "$HERMES_WEB_UI_HOME" "$UPLOAD_DIR"

log "starting Hermes Studio container"
log "web ui: bind=${BIND_HOST} port=${PORT}"
log "hermes home: ${HERMES_HOME}"
log "web ui home: ${HERMES_WEB_UI_HOME}"
log "hermes bin: ${HERMES_BIN:-unresolved}"
log "agent root: ${HERMES_AGENT_ROOT:-unresolved}"
log "bridge python: ${HERMES_AGENT_BRIDGE_PYTHON:-unresolved}"
log "bridge endpoint: ${HERMES_AGENT_BRIDGE_ENDPOINT}"
log "bridge transport: ${HERMES_AGENT_BRIDGE_WORKER_TRANSPORT}"
log "bridge warm profiles: ${HERMES_AGENT_BRIDGE_WARM_PROFILES}"
log "bridge worker idle timeout: ${HERMES_AGENT_BRIDGE_WORKER_IDLE_TIMEOUT_SECONDS}s"
log "bridge session idle timeout: ${HERMES_AGENT_BRIDGE_SESSION_IDLE_TIMEOUT_SECONDS}s"

exec "$@"
