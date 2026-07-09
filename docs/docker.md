# Docker Compose Guide

This repository ships an environment-variable driven Docker Compose setup.

## Quick Start

### Pull pre-built image (Recommended)

```bash
# 1) Scaffold the mapped Hermes home on the host
WEBUI_IMAGE=ekkoye8888/hermes-web-ui docker compose run --rm hermes-webui prepare-hermes-home

# 2) Edit ./hermes_data/config.yaml before first startup
# cp ./hermes_data/config.yaml.example ./hermes_data/config.yaml

# 3) Start the service
WEBUI_IMAGE=ekkoye8888/hermes-web-ui docker compose up -d
docker compose logs -f hermes-webui
```

Open: `http://localhost:6060`

### Build from source

```bash
# 1) Scaffold the mapped Hermes home on the host
docker compose run --rm hermes-webui prepare-hermes-home

# 2) Edit ./hermes_data/config.yaml before first startup
# cp ./hermes_data/config.yaml.example ./hermes_data/config.yaml

# 3) Start the service
docker compose up -d --build
docker compose logs -f hermes-webui
```

## Services

This compose file runs a single service:

- `hermes-webui` — Web UI dashboard with integrated Hermes Agent runtime (pre-built image or built from source)

The Web UI container is built on the `nousresearch/hermes-agent` base image and uses the Hermes CLI / agent bridge runtime for chat execution. By default it performs startup gateway checks/autostart for profiles, but no Hermes gateway ports are exposed by this compose setup.

At container start, the image entrypoint now performs runtime discovery inside
the container and exports:

- `HERMES_BIN`
- `HERMES_AGENT_ROOT` when a bundled source checkout exists
- `HERMES_AGENT_BRIDGE_PYTHON`
- `HERMES_AGENT_BRIDGE_ENDPOINT`
- `HERMES_AGENT_BRIDGE_WORKER_TRANSPORT`
- `HERMES_AGENT_BRIDGE_WARM_PROFILES`

This makes the container self-contained for Hermes chat runs. In other words,
the Web UI talks to the Hermes Agent runtime shipped in the same image instead
of relying on a host-side Hermes installation.

The container entrypoint also supports:

```bash
docker compose run --rm hermes-webui prepare-hermes-home
```

That command only prepares the host-mounted Hermes directory structure and
example files. It does not start the Web UI.

## Environment Variables

All key runtime settings are configured from compose variables.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `6060` | Web UI listen port |
| `BIND_HOST` | `0.0.0.0` | Optional Web UI bind host. Defaults to IPv4 for stable WSL/Windows access. Set `::` explicitly if you want IPv6 listening. |
| `CORS_ORIGINS` | same host only | Comma- or space-separated cross-origin allowlist for HTTP, Socket.IO, and WebSocket requests. Set `*` only when you intentionally need legacy wildcard CORS. |
| `HERMES_AGENT_IMAGE` | `nousresearch/hermes-agent:latest` | Hermes Agent base image (used only during build) |
| `NODE_VERSION` | `24.15.0` | Node.js version installed into the image during build |
| `WEBUI_IMAGE` | `hermes-web-ui-local:latest` | Web UI image (set to `ekkoye8888/hermes-web-ui` to use pre-built) |
| `HERMES_HOME_DIR` | `./hermes_data` | Host directory mapped to `/home/agent/.hermes` |
| `HERMES_WEB_UI_HOME_DIR` | `./hermes_data/hermes-web-ui` | Host directory mapped to `/home/agent/.hermes-web-ui` |
| `HERMES_ACTIVE_PROFILE` | `default` | Hermes profile name to activate at container boot |
| `HERMES_DOCKER_REQUIRE_PROFILE_CONFIG` | `1` | Fail startup when the active profile has no `config.yaml` yet |
| `HERMES_AGENT_BRIDGE_ENDPOINT` | `tcp://127.0.0.1:18765` | In-container Hermes bridge broker endpoint |
| `HERMES_AGENT_BRIDGE_AUTO_RESTART` | `1` | Auto-restart Hermes bridge broker after unexpected exit |
| `HERMES_AGENT_BRIDGE_WORKER_TRANSPORT` | `tcp` | Transport used by Hermes bridge workers inside the container |
| `HERMES_AGENT_BRIDGE_WORKER_PORT_BASE` | `18780` | Base port for Hermes bridge worker processes when using TCP |
| `HERMES_WEB_UI_REQUIRE_AGENT_BRIDGE` | `1` | Fail container startup when the Hermes bridge cannot start |
| `HERMES_AGENT_BRIDGE_WARM_PROFILES` | `active` | Prestart profile workers at boot. Use `active`, `default`, or comma-separated profile names |
| `HERMES_AGENT_BRIDGE_WORKER_IDLE_TIMEOUT_SECONDS` | `86400` | Worker idle timeout inside the container |
| `HERMES_AGENT_BRIDGE_SESSION_IDLE_TIMEOUT_SECONDS` | `86400` | Session idle timeout inside the container |

Override variables directly from shell:

```bash
PORT=16060 docker compose up -d
```

Or create a `.env` file in the project root:

```
WEBUI_IMAGE=ekkoye8888/hermes-web-ui
PORT=6060
HERMES_ACTIVE_PROFILE=default
```

## Data Persistence

| Path | Description |
|---|---|
| `${HERMES_HOME_DIR}` (`./hermes_data`) | Hermes runtime data (sessions, config, profiles) |
| `${HERMES_WEB_UI_HOME_DIR}` (`./hermes_data/hermes-web-ui`) | Web UI data (auth token, etc.) |

- Hermes data persists in `./hermes_data`, mapped to `/home/agent/.hermes` in the container.
- Web UI data persists in `./hermes_data/hermes-web-ui/`, mapped to `/home/agent/.hermes-web-ui` in the container.
- The auth token is auto-generated on first run and printed to container logs.
- Deleting the token file and restarting will generate a new one.

### Profile Config Mapping

The Docker setup intentionally maps the whole Hermes home instead of a single
file, so you can edit profile files on the host before startup:

- Default profile config: `./hermes_data/config.yaml`
- Default profile credentials: `./hermes_data/auth.json`
- Named profile config: `./hermes_data/profiles/<name>/config.yaml`
- Named profile credentials: `./hermes_data/profiles/<name>/auth.json`

If `HERMES_DOCKER_REQUIRE_PROFILE_CONFIG=1` and the active profile has no
`config.yaml`, the container exits early with an explicit error instead of
booting a half-configured Hermes runtime.

## Port Mapping

| Port | Description |
|---|---|
| `${PORT}` (6060) | Web UI dashboard |

No Hermes gateway ports are exposed by this compose setup.

## Code Runtime Behavior

- Hermes CLI binary is resolved by the container entrypoint first, then reused by the backend (`packages/server/src/services/hermes/hermes-cli.ts`).
- If the image also contains a Hermes Agent source checkout with `run_agent.py`, the entrypoint exports `HERMES_AGENT_ROOT` so the Python bridge can attach directly to that runtime.
- Profile-specific chat runs are handled through the Hermes agent bridge. The selected/requested profile is authorized per account and passed with runtime requests; switching the frontend Hermes Profile does not restart the bridge or clear other running tasks.
- The container now warms the active Hermes profile worker during startup so the runtime is available immediately after `docker compose up`.
- Hermes itself is started inside the same container through the managed gateway + agent bridge path. There is no separate host-side Hermes daemon to launch.
- `restart: unless-stopped` keeps the container resident, and `HERMES_AGENT_BRIDGE_AUTO_RESTART=1` keeps the broker recoverable after unexpected exits.
- Docker defaults worker/session idle GC to 24 hours to avoid profiles appearing offline shortly after inactivity. Override the env vars above if you want a shorter or longer retention window.
- Docker is a managed gateway runtime: Web UI checks profile gateways on startup, but it does not run a periodic gateway recovery loop.

## Common Operations

Recreate:

```bash
docker compose up -d --force-recreate
```

Prepare mapped Hermes config files without starting the service:

```bash
docker compose run --rm hermes-webui prepare-hermes-home
```

Start with a named profile:

```bash
HERMES_ACTIVE_PROFILE=ops docker compose up -d
```

View auth token:

```bash
docker compose logs hermes-webui | grep token
# or
cat ./hermes_data/hermes-web-ui/.token
```

Stop:

```bash
docker compose down
```
