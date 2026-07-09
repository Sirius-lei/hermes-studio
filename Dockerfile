ARG BASE_IMAGE=nousresearch/hermes-agent:latest
FROM ${BASE_IMAGE}

ARG NODE_VERSION=24.15.0

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    make \
    g++ \
    tini \
    && rm -rf /var/lib/apt/lists/*

RUN ARCH=$(dpkg --print-architecture) \
    && if [ "$ARCH" = "amd64" ]; then NODE_ARCH="x64"; else NODE_ARCH="$ARCH"; fi \
    && echo "Downloading Node.js v${NODE_VERSION} for ${NODE_ARCH}" \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz" \
       -o /tmp/node.tar.gz \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
       /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    && tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1 \
    && rm -f /tmp/node.tar.gz \
    && node --version \
    && npm --version

WORKDIR /app

COPY package*.json ./
# Increase Node.js memory limit to prevent OOM during build
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm ci --ignore-scripts && npm rebuild node-pty

COPY . .

RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV HOME=/home/agent
ENV HERMES_HOME=/home/agent/.hermes
ENV HERMES_WEB_UI_HOME=/home/agent/.hermes-web-ui
ENV HERMES_WEB_UI_MANAGED_GATEWAY=1
ENV HERMES_WEB_UI_REQUIRE_AGENT_BRIDGE=1
ENV PORT=6060
ENV BIND_HOST=0.0.0.0
ENV HERMES_ACTIVE_PROFILE=default
ENV HERMES_AGENT_BRIDGE_ENDPOINT=tcp://127.0.0.1:18765
ENV HERMES_AGENT_BRIDGE_AUTO_RESTART=1
ENV HERMES_AGENT_BRIDGE_WORKER_TRANSPORT=tcp
ENV HERMES_AGENT_BRIDGE_WORKER_PORT_BASE=18780
ENV HERMES_AGENT_BRIDGE_WARM_PROFILES=active
ENV HERMES_AGENT_BRIDGE_WORKER_IDLE_TIMEOUT_SECONDS=86400
ENV HERMES_AGENT_BRIDGE_SESSION_IDLE_TIMEOUT_SECONDS=86400
ENV HERMES_DOCKER_REQUIRE_PROFILE_CONFIG=0
ENV PATH=/opt/hermes/.venv/bin:$PATH

COPY docker/entrypoint.sh /usr/local/bin/hermes-web-ui-entrypoint
RUN chmod +x /usr/local/bin/hermes-web-ui-entrypoint

EXPOSE 6060

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-6060}/health" >/dev/null || exit 1

# 强制覆盖基础镜像的默认启动脚本，让镜像本身具备独立运行的能力
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/hermes-web-ui-entrypoint"]
CMD ["node", "dist/server/index.js"]
