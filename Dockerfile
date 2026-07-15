FROM node:24-bookworm-slim

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    ffmpeg \
    git \
    python3 \
    python3-pip \
    python3-venv \
    tini \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --home-dir /home/agent --shell /bin/sh agent

COPY runtime/diting-agent /opt/diting/diting-agent
RUN python3 -m venv /opt/diting/.venv \
    && /opt/diting/.venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
    && /opt/diting/.venv/bin/pip install --no-cache-dir /opt/diting/diting-agent

WORKDIR /app

COPY package*.json ./
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm ci --ignore-scripts && npm rebuild node-pty

COPY . .
RUN npm run build && npm prune --omit=dev

RUN mkdir -p /home/agent/.diting /home/agent/.diting-web-ui \
    && chown -R agent:agent /home/agent /app /opt/diting

ENV NODE_ENV=production
ENV HOME=/home/agent
ENV DiTing_HOME=/home/agent/.diting
ENV DiTing_WEB_UI_HOME=/home/agent/.diting-web-ui
ENV DiTing_WEB_UI_MANAGED_GATEWAY=1
ENV DiTing_WEB_UI_REQUIRE_AGENT_BRIDGE=1
ENV DiTing_BIN=/opt/diting/.venv/bin/diting
ENV DiTing_AGENT_ROOT=/opt/diting/diting-agent
ENV DiTing_AGENT_BRIDGE_PYTHON=/opt/diting/.venv/bin/python
ENV PORT=6060
ENV BIND_HOST=0.0.0.0
ENV DiTing_ACTIVE_PROFILE=default
ENV DiTing_AGENT_BRIDGE_ENDPOINT=tcp://127.0.0.1:28765
ENV DiTing_AGENT_BRIDGE_AUTO_RESTART=1
ENV DiTing_AGENT_BRIDGE_WORKER_TRANSPORT=tcp
ENV DiTing_AGENT_BRIDGE_WORKER_PORT_BASE=28780
ENV DiTing_AGENT_BRIDGE_WARM_PROFILES=active
ENV DiTing_AGENT_BRIDGE_WORKER_IDLE_TIMEOUT_SECONDS=86400
ENV DiTing_AGENT_BRIDGE_SESSION_IDLE_TIMEOUT_SECONDS=86400
ENV DiTing_DOCKER_REQUIRE_PROFILE_CONFIG=0
ENV PYTHONPATH=/opt/diting/diting-agent
ENV PATH=/opt/diting/.venv/bin:$PATH

COPY docker/entrypoint.sh /usr/local/bin/diting-web-ui-entrypoint
RUN chmod +x /usr/local/bin/diting-web-ui-entrypoint

USER agent

EXPOSE 6060

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-6060}/health" >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/diting-web-ui-entrypoint"]
CMD ["node", "dist/server/index.js"]
