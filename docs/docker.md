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
| `DiTing_PYPI_INDEX_URL` | empty | Internal Python package index for Docker builds and runtime lazy installs. |
| `DiTing_PYPI_EXTRA_INDEX_URL` | empty | Comma- or newline-separated extra Python package indexes. |
| `DiTing_PYPI_TRUSTED_HOST` | empty | Comma- or newline-separated hosts allowed for non-TLS package indexes. Prefer HTTPS. |
| `DiTing_ACTIVE_PROFILE` | `default` | Active profile |
| `DiTing_DOCKER_REQUIRE_PROFILE_CONFIG` | `0` | Require profile config before startup |
| `DiTing_AGENT_BRIDGE_WARM_PROFILES` | `active` | Profiles to prewarm after Web startup |

The runtime also accepts the same values in `config.yaml` under `security`.
Environment variables take precedence, which is useful for deployment secrets:

```yaml
security:
  pypi_index_url: https://devpi.intra.example/root/pypi/+simple/
  pypi_extra_index_urls: []
  pypi_trusted_hosts: []
```

Build the image against an internal devpi source with the Compose build args:

```bash
DiTing_PYPI_INDEX_URL=https://devpi.intra.example/root/pypi/+simple/ \
docker compose build diting-webui
```

The root Web UI Dockerfile and `runtime/diting-agent/Dockerfile` accept the
same `DITING_PYPI_*` build arguments.

Do not commit credentials in a URL or bake them into a reusable image. Inject
authenticated values through the deployment environment or a secret-aware
build process. The standard `PIP_INDEX_URL`, `PIP_EXTRA_INDEX_URL`, and
`PIP_TRUSTED_HOST` variables are also accepted by runtime lazy installs when
the DiTing-specific variables and config values are empty.

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
docker compose build diting-webui
docker tag diting-web-ui-local:latest diting-web-ui:0.6.20
docker save diting-web-ui:0.6.20 | gzip > diting-web-ui-0.6.20.tar.gz
```

When the connected build machine uses an internal devpi source, export
`DiTing_PYPI_INDEX_URL` (and, if needed, the extra-index/trusted-host
variables) before `docker compose build`.

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
