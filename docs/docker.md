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
| `DiTing_OFFLINE` | `1` in Docker | Disable optional remote catalogs, update checks, and runtime downloads. Configured model APIs remain available. |
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

## Offline Deployment

An air-gapped host cannot build this Dockerfile from source because the build
needs the Node base image, Debian packages, npm dependencies, and Python
wheels. Build the image once on a connected machine, then transfer the image
archive and the two mapped data directories.

On the connected build machine:

```bash
docker build -t diting-web-ui:0.6.20 .
docker save diting-web-ui:0.6.20 | gzip > diting-web-ui-0.6.20.tar.gz
```

On the offline host:

```bash
docker load < diting-web-ui-0.6.20.tar.gz
WEBUI_IMAGE=diting-web-ui:0.6.20 docker compose -f docker-compose.offline.yml up -d --no-build
docker compose -f docker-compose.offline.yml logs -f diting-webui
```

`docker-compose.offline.yml` has no `build:` section, so Compose will not
attempt a registry pull or package installation. The image already contains
the Web UI, Node production dependencies, Python environment, and DiTing
Bridge. The model provider URL configured in `diting_data` still must be
reachable from the internal network; offline mode only removes optional
package/catalog/update traffic.
