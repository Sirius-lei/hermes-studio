# Docker Compose Guide

This repository ships an environment-variable driven Docker Compose setup.

## Quick Start

### Pull pre-built image (Recommended)

```bash
# 1) Scaffold the mapped DiTing home on the host
WEBUI_IMAGE=ekkoye8888/DiTing-web-ui docker compose run --rm DiTing-webui prepare-DiTing-home

# 2) Edit ./DiTing_data/config.yaml before first startup
# cp ./DiTing_data/config.yaml.example ./DiTing_data/config.yaml

# 3) Start the service
WEBUI_IMAGE=ekkoye8888/DiTing-web-ui docker compose up -d
docker compose logs -f DiTing-webui
```

Open: `http://localhost:6060`

### Build from source

```bash
# 1) Scaffold the mapped DiTing home on the host
docker compose run --rm DiTing-webui prepare-DiTing-home

# 2) Edit ./DiTing_data/config.yaml before first startup
# cp ./DiTing_data/config.yaml.example ./DiTing_data/config.yaml

# 3) Start the service
docker compose up -d --build
docker compose logs -f DiTing-webui
```

## Services

This compose file runs a single service:

- `DiTing-webui` — Web UI dashboard with integrated DiTing Agent runtime (pre-built image or built from source)

The Web UI container is built on the `nousresearch/DiTing-agent` base image and uses the DiTing CLI / agent bridge runtime for chat execution. By default it performs startup gateway checks/autostart for profiles, but no DiTing gateway ports are exposed by this compose setup.

At container start, the image entrypoint now performs runtime discovery inside
the container and exports:

- `DiTing_BIN`
- `DiTing_AGENT_ROOT` when a bundled source checkout exists
- `DiTing_AGENT_BRIDGE_PYTHON`
- `DiTing_AGENT_BRIDGE_ENDPOINT`
- `DiTing_AGENT_BRIDGE_WORKER_TRANSPORT`
- `DiTing_AGENT_BRIDGE_WARM_PROFILES`

This makes the container self-contained for DiTing chat runs. In other words,
the Web UI talks to the DiTing Agent runtime shipped in the same image instead
of relying on a host-side DiTing installation.

The container entrypoint also supports:

```bash
docker compose run --rm DiTing-webui prepare-DiTing-home
```

That command only prepares the host-mounted DiTing directory structure and
example files. It does not start the Web UI.

## Environment Variables

All key runtime settings are configured from compose variables.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `6060` | Web UI listen port |
| `BIND_HOST` | `0.0.0.0` | Optional Web UI bind host. Defaults to IPv4 for stable WSL/Windows access. Set `::` explicitly if you want IPv6 listening. |
| `CORS_ORIGINS` | same host only | Comma- or space-separated cross-origin allowlist for HTTP, Socket.IO, and WebSocket requests. Set `*` only when you intentionally need legacy wildcard CORS. |
| `DiTing_AGENT_IMAGE` | `nousresearch/DiTing-agent:latest` | DiTing Agent base image (used only during build) |
| `NODE_VERSION` | `24.15.0` | Node.js version installed into the image during build |
| `WEBUI_IMAGE` | `DiTing-web-ui-local:latest` | Web UI image (set to `ekkoye8888/DiTing-web-ui` to use pre-built) |
| `DiTing_HOME_DIR` | `./DiTing_data` | Host directory mapped to `/home/agent/.DiTing` |
| `DiTing_WEB_UI_HOME_DIR` | `./DiTing_data/DiTing-web-ui` | Host directory mapped to `/home/agent/.DiTing-web-ui` |
| `DiTing_ACTIVE_PROFILE` | `default` | DiTing profile name to activate at container boot |
| `DiTing_DOCKER_REQUIRE_PROFILE_CONFIG` | `1` | Fail startup when the active profile has no `config.yaml` yet |
| `DiTing_AGENT_BRIDGE_ENDPOINT` | `tcp://127.0.0.1:18765` | In-container DiTing bridge broker endpoint |
| `DiTing_AGENT_BRIDGE_AUTO_RESTART` | `1` | Auto-restart DiTing bridge broker after unexpected exit |
| `DiTing_AGENT_BRIDGE_WORKER_TRANSPORT` | `tcp` | Transport used by DiTing bridge workers inside the container |
| `DiTing_AGENT_BRIDGE_WORKER_PORT_BASE` | `18780` | Base port for DiTing bridge worker processes when using TCP |
| `DiTing_WEB_UI_REQUIRE_AGENT_BRIDGE` | `1` | Fail container startup when the DiTing bridge cannot start |
| `DiTing_AGENT_BRIDGE_WARM_PROFILES` | `active` | Prestart profile workers at boot. Use `active`, `default`, or comma-separated profile names |
| `DiTing_AGENT_BRIDGE_WORKER_IDLE_TIMEOUT_SECONDS` | `86400` | Worker idle timeout inside the container |
| `DiTing_AGENT_BRIDGE_SESSION_IDLE_TIMEOUT_SECONDS` | `86400` | Session idle timeout inside the container |

Override variables directly from shell:

```bash
PORT=16060 docker compose up -d
```

Or create a `.env` file in the project root:

```
WEBUI_IMAGE=ekkoye8888/DiTing-web-ui
PORT=6060
DiTing_ACTIVE_PROFILE=default
```

## Data Persistence

| Path | Description |
|---|---|
| `${DiTing_HOME_DIR}` (`./DiTing_data`) | DiTing runtime data (sessions, config, profiles) |
| `${DiTing_WEB_UI_HOME_DIR}` (`./DiTing_data/DiTing-web-ui`) | Web UI data (auth token, etc.) |

- DiTing data persists in `./DiTing_data`, mapped to `/home/agent/.DiTing` in the container.
- Web UI data persists in `./DiTing_data/DiTing-web-ui/`, mapped to `/home/agent/.DiTing-web-ui` in the container.
- The auth token is auto-generated on first run and printed to container logs.
- Deleting the token file and restarting will generate a new one.

### Profile Config Mapping

The Docker setup intentionally maps the whole DiTing home instead of a single
file, so you can edit profile files on the host before startup:

- Default profile config: `./DiTing_data/config.yaml`
- Default profile credentials: `./DiTing_data/auth.json`
- Named profile config: `./DiTing_data/profiles/<name>/config.yaml`
- Named profile credentials: `./DiTing_data/profiles/<name>/auth.json`

If `DiTing_DOCKER_REQUIRE_PROFILE_CONFIG=1` and the active profile has no
`config.yaml`, the container exits early with an explicit error instead of
booting a half-configured DiTing runtime.

## Port Mapping

| Port | Description |
|---|---|
| `${PORT}` (6060) | Web UI dashboard |

No DiTing gateway ports are exposed by this compose setup.

## Code Runtime Behavior

- DiTing CLI binary is resolved by the container entrypoint first, then reused by the backend (`packages/server/src/services/DiTing/DiTing-cli.ts`).
- If the image also contains a DiTing Agent source checkout with `run_agent.py`, the entrypoint exports `DiTing_AGENT_ROOT` so the Python bridge can attach directly to that runtime.
- Profile-specific chat runs are handled through the DiTing agent bridge. The selected/requested profile is authorized per account and passed with runtime requests; switching the frontend DiTing Profile does not restart the bridge or clear other running tasks.
- The container now warms the active DiTing profile worker during startup so the runtime is available immediately after `docker compose up`.
- DiTing itself is started inside the same container through the managed gateway + agent bridge path. There is no separate host-side DiTing daemon to launch.
- `restart: unless-stopped` keeps the container resident, and `DiTing_AGENT_BRIDGE_AUTO_RESTART=1` keeps the broker recoverable after unexpected exits.
- Docker defaults worker/session idle GC to 24 hours to avoid profiles appearing offline shortly after inactivity. Override the env vars above if you want a shorter or longer retention window.
- Docker is a managed gateway runtime: Web UI checks profile gateways on startup, but it does not run a periodic gateway recovery loop.

## Common Operations

Recreate:

```bash
docker compose up -d --force-recreate
```

Prepare mapped DiTing config files without starting the service:

```bash
docker compose run --rm DiTing-webui prepare-DiTing-home
```

Start with a named profile:

```bash
DiTing_ACTIVE_PROFILE=ops docker compose up -d
```

View auth token:

```bash
docker compose logs DiTing-webui | grep token
# or
cat ./DiTing_data/DiTing-web-ui/.token
```

Stop:

```bash
docker compose down
```
