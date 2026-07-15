#!/bin/sh
set -eu

log() {
  printf '[docker-entrypoint] %s\n' "$*" >&2
}

flag_enabled() {
  normalized="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [ "$normalized" = "1" ] || [ "$normalized" = "true" ] || [ "$normalized" = "yes" ] || [ "$normalized" = "on" ]
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
    "${DiTing_AGENT_ROOT:-}" \
    /opt/diting/diting-agent \
    /opt/diting-agent \
    /usr/local/lib/diting-agent \
    "${DiTing_HOME}/diting-agent"
  do
    if [ -n "$candidate" ] && [ -f "$candidate/run_agent.py" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

resolve_examples_dir() {
  for candidate in \
    /app/docker/examples \
    "$(dirname "$0")/../docker/examples" \
    "$(pwd)/docker/examples"
  do
    if [ -d "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

copy_if_missing() {
  src="$1"
  dest="$2"
  if [ -f "$src" ] && [ ! -e "$dest" ]; then
    mkdir -p "$(dirname "$dest")"
    cp "$src" "$dest"
  fi
}

profile_name_from_file() {
  active_file="$DiTing_HOME/active_profile"
  if [ -f "$active_file" ]; then
    active_name="$(tr -d '\r' <"$active_file" | head -n 1 | tr -d '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    if [ -n "$active_name" ]; then
      printf '%s\n' "$active_name"
      return 0
    fi
  fi
  return 1
}

current_profile_name() {
  if [ -n "${DiTing_ACTIVE_PROFILE:-}" ]; then
    printf '%s\n' "$DiTing_ACTIVE_PROFILE"
    return 0
  fi
  if profile_name_from_file >/dev/null 2>&1; then
    profile_name_from_file
    return 0
  fi
  printf 'default\n'
}

profile_dir_for_name() {
  name="${1:-default}"
  if [ -z "$name" ] || [ "$name" = "default" ]; then
    printf '%s\n' "$DiTing_HOME"
  else
    printf '%s/profiles/%s\n' "$DiTing_HOME" "$name"
  fi
}

ensure_active_profile_file() {
  profile_name="$(current_profile_name)"
  profile_dir="$(profile_dir_for_name "$profile_name")"
  mkdir -p "$profile_dir"
  printf '%s\n' "$profile_name" >"$DiTing_HOME/active_profile"
  export DiTing_ACTIVE_PROFILE="$profile_name"
}

prepare_DiTing_home() {
  examples_dir="$(resolve_examples_dir || true)"
  profile_name="$(current_profile_name)"
  profile_dir="$(profile_dir_for_name "$profile_name")"

  mkdir -p "$DiTing_HOME" "$DiTing_WEB_UI_HOME" "$UPLOAD_DIR" "$DiTing_HOME/profiles" "$profile_dir"
  ensure_active_profile_file

  if [ -n "$examples_dir" ]; then
    copy_if_missing "$examples_dir/DiTing_HOME.README.md" "$DiTing_HOME/DOCKER_SETUP.md"
    copy_if_missing "$examples_dir/config.yaml.example" "$profile_dir/config.yaml.example"
    copy_if_missing "$examples_dir/auth.json.example" "$profile_dir/auth.json.example"
  else
    log "warning: docker example templates were not found; only directory scaffolding was created"
  fi

  log "prepared DiTing home at ${DiTing_HOME}"
  log "active profile: ${profile_name}"
  log "profile directory: ${profile_dir}"
  if [ ! -f "$profile_dir/config.yaml" ]; then
    log "config.yaml is missing; copy config.yaml.example to config.yaml and edit provider/model before startup"
  fi
  if [ ! -f "$profile_dir/auth.json" ]; then
    log "auth.json is optional here; some providers may still require credentials in that file or via UI auth flows"
  fi
}

validate_runtime_profile() {
  profile_name="$(current_profile_name)"
  profile_dir="$(profile_dir_for_name "$profile_name")"
  config_path="$profile_dir/config.yaml"

  if flag_enabled "${DiTing_DOCKER_REQUIRE_PROFILE_CONFIG:-0}" && [ ! -f "$config_path" ]; then
    log "error: missing DiTing profile config: $config_path"
    log "run: docker compose run --rm diting-webui prepare-diting-home"
    log "then create config.yaml from config.yaml.example under the mapped DiTing home before starting the service"
    exit 1
  fi

  if [ ! -f "$config_path" ]; then
    log "warning: config.yaml not found for profile ${profile_name}; DiTing runtime may start without a usable model configuration"
  fi
}

set_default_if_empty HOME /home/agent
set_default_if_empty PORT 6060
set_default_if_empty BIND_HOST 0.0.0.0
set_default_if_empty DiTing_HOME /home/agent/.diting
set_default_if_empty DiTing_WEB_UI_HOME /home/agent/.diting-web-ui
set_default_if_empty DiTing_WEB_UI_MANAGED_GATEWAY 1
set_default_if_empty DiTing_WEB_UI_REQUIRE_AGENT_BRIDGE 1
set_default_if_empty DiTing_ACTIVE_PROFILE default
set_default_if_empty DiTing_DOCKER_REQUIRE_PROFILE_CONFIG 0
set_default_if_empty DiTing_AGENT_BRIDGE_ENDPOINT tcp://127.0.0.1:28765
set_default_if_empty DiTing_AGENT_BRIDGE_AUTO_RESTART 1
set_default_if_empty DiTing_AGENT_BRIDGE_WORKER_TRANSPORT tcp
set_default_if_empty DiTing_AGENT_BRIDGE_WORKER_PORT_BASE 28780
set_default_if_empty DiTing_AGENT_BRIDGE_STARTUP_TIMEOUT_MS 120000
set_default_if_empty DiTing_AGENT_BRIDGE_WARM_PROFILES active
set_default_if_empty DiTing_AGENT_BRIDGE_WORKER_IDLE_TIMEOUT_SECONDS 86400
set_default_if_empty DiTing_AGENT_BRIDGE_SESSION_IDLE_TIMEOUT_SECONDS 86400
set_default_if_empty UPLOAD_DIR "${DiTing_WEB_UI_HOME}/upload"

if [ -z "${DiTing_BIN:-}" ]; then
  if DiTing_bin="$(find_first_executable /opt/diting/.venv/bin/diting /usr/local/bin/diting "$(command -v diting 2>/dev/null || true)")"; then
    export DiTing_BIN="$DiTing_bin"
  else
    log "warning: DiTing CLI binary not found in expected locations"
  fi
fi

if [ -z "${DiTing_AGENT_ROOT:-}" ]; then
  if agent_root="$(find_agent_root)"; then
    export DiTing_AGENT_ROOT="$agent_root"
  fi
fi

if [ -z "${DiTing_AGENT_BRIDGE_PYTHON:-}" ]; then
  if bridge_python="$(find_first_executable /opt/diting/.venv/bin/python3 /opt/diting/.venv/bin/python /usr/bin/python3 "$(command -v python3 2>/dev/null || true)" "$(command -v python 2>/dev/null || true)")"; then
    export DiTing_AGENT_BRIDGE_PYTHON="$bridge_python"
  else
    log "warning: no Python interpreter found for DiTing agent bridge"
  fi
fi

mkdir -p "$DiTing_HOME" "$DiTing_WEB_UI_HOME" "$UPLOAD_DIR"

case "${1:-}" in
  prepare-diting-home)
    shift || true
    if [ $# -gt 0 ] && [ -n "${1:-}" ]; then
      export DiTing_ACTIVE_PROFILE="$1"
    fi
    prepare_DiTing_home
    exit 0
    ;;
esac

prepare_DiTing_home
validate_runtime_profile

log "starting DiTing Studio container"
log "web ui: bind=${BIND_HOST} port=${PORT}"
log "DiTing home: ${DiTing_HOME}"
log "web ui home: ${DiTing_WEB_UI_HOME}"
log "active profile: ${DiTing_ACTIVE_PROFILE}"
log "DiTing bin: ${DiTing_BIN:-unresolved}"
log "agent root: ${DiTing_AGENT_ROOT:-unresolved}"
log "bridge python: ${DiTing_AGENT_BRIDGE_PYTHON:-unresolved}"
log "bridge endpoint: ${DiTing_AGENT_BRIDGE_ENDPOINT}"
log "bridge auto restart: ${DiTing_AGENT_BRIDGE_AUTO_RESTART}"
log "bridge transport: ${DiTing_AGENT_BRIDGE_WORKER_TRANSPORT}"
log "bridge warm profiles: ${DiTing_AGENT_BRIDGE_WARM_PROFILES}"
log "bridge worker idle timeout: ${DiTing_AGENT_BRIDGE_WORKER_IDLE_TIMEOUT_SECONDS}s"
log "bridge session idle timeout: ${DiTing_AGENT_BRIDGE_SESSION_IDLE_TIMEOUT_SECONDS}s"
log "runtime mode: integrated DiTing Agent via managed gateway + agent bridge"

exec "$@"
