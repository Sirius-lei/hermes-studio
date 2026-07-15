# Docker Compose Guide

The Docker image is self-contained: it builds DiTing Agent from
`runtime/diting-agent`, installs the Python runtime, builds the Web UI, and
starts both through one container entrypoint.

## Build And Start

Prepare an isolated DiTing data directory:

```bash
docker compose run --rm diting-webui prepare-diting-home
```

Optionally copy and edit the generated profile configuration:

```bash
cp ./diting_data/config.yaml.example ./diting_data/config.yaml
```

Build and start:

```bash
docker compose up -d --build
docker compose logs -f diting-webui
```

Open `http://localhost:16060`.

The default configuration allows the container to start without a model
profile. Set `DiTing_DOCKER_REQUIRE_PROFILE_CONFIG=1` when deployment should
fail until `config.yaml` exists.

## Isolation

The container does not read a host Agent installation. Its runtime and state
are isolated as follows:

| Resource | Default |
| --- | --- |
| Container | `diting-webui` |
| Image | `diting-web-ui-local:latest` |
| Web port | `16060` on the host, `6060` in the container |
| Agent state | `./diting_data` -> `/home/agent/.diting` |
| Web UI state | `./diting_webui_data` -> `/home/agent/.diting-web-ui` |
| Bridge broker | `tcp://127.0.0.1:28765` inside the container |
| Worker port base | `28780` inside the container |

No Bridge or Gateway port is exposed to the host.

## Configuration

Common Compose overrides:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DITING_WEB_PORT` | `16060` | Host Web UI port |
| `WEBUI_IMAGE` | `diting-web-ui-local:latest` | Built image name |
| `WEBUI_CONTAINER_NAME` | `diting-webui` | Container name |
| `DiTing_HOME_DIR` | `./diting_data` | Host Agent state directory |
| `DiTing_WEB_UI_HOME_DIR` | `./diting_webui_data` | Host Web UI state directory |
| `DiTing_ACTIVE_PROFILE` | `default` | Active profile |
| `DiTing_DOCKER_REQUIRE_PROFILE_CONFIG` | `0` | Require profile config before startup |
| `DiTing_AGENT_BRIDGE_WARM_PROFILES` | `active` | Profiles to prewarm after Web startup |

Example custom port:

```bash
DITING_WEB_PORT=16061 docker compose up -d
```

## Operations

```bash
docker compose ps
docker compose logs -f diting-webui
docker compose restart diting-webui
docker compose down
```

The generated login token is stored at `./diting_webui_data/.token` and is
also available in the startup logs.
