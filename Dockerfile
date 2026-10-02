FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    DATA_BACKEND=postgres \
    DATA_DIR=/var/lib/varadise/data \
    RUNTIME_DIR=/var/lib/varadise/runtime \
    HOST=0.0.0.0 \
    PORT=3000 \
    VARADISE_RUNTIME_ENVIRONMENT=docker \
    HERMES_WHATSAPP_NODE=/usr/local/bin/node \
    HERMES_WHATSAPP_PAIR_SCRIPT=/app/apps/control-plane/src/whatsapp-pair.mjs \
    HERMES_WHATSAPP_PROJECT_BRIDGE_SCRIPT=/app/apps/control-plane/src/project-whatsapp-bridge.mjs

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl git util-linux python3 python3-pip python3-venv build-essential fonts-noto-cjk libreoffice-writer tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable \
    && corepack prepare pnpm@10.15.0 --activate \
    && pnpm install --prod --frozen-lockfile

COPY --chown=node:node apps ./apps
COPY --chown=node:node packages ./packages
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /var/lib/varadise/data/uploads /var/lib/varadise/runtime \
    /home/node/.local/bin /home/node/.config /home/node/.cache /home/node/.hermes \
    && chown -R node:node /var/lib/varadise /home/node/.local /home/node/.config /home/node/.cache /home/node/.hermes

USER node
ARG HERMES_AGENT_INSTALL_URL=https://hermes-agent.nousresearch.com/install.sh
ENV HOME=/home/node \
    PATH=/home/node/.local/bin:/home/node/.hermes/bin:${PATH} \
    HERMES_AGENT_CLI=hermes \
    HERMES_AGENT_VENDOR=nousresearch \
    HERMES_AGENT_CLI_PROVIDER=custom
RUN curl -fsSL "${HERMES_AGENT_INSTALL_URL}" | bash \
    && printf '%s\n' '#!/bin/sh' 'set -e' 'for candidate in "$HOME/.hermes/hermes-agent/.hermes/bin/hermes" "$HOME/.hermes/hermes-agent/venv/bin/hermes"; do if [ -x "$candidate" ]; then exec "$candidate" "$@"; fi; done' 'echo "Hermes executable was not found under $HOME/.hermes/hermes-agent" >&2' 'exit 127' > /home/node/.local/bin/hermes \
    && chmod +x /home/node/.local/bin/hermes \
    && command -v hermes \
    && hermes --version
ENV HERMES_AGENT_MIDDLEWARE_PORT=3010 \
    HERMES_AGENT_MIDDLEWARE_MAX_REQUEST_BYTES=67108864 \
    HERMES_AGENT_MIDDLEWARE_URL=http://127.0.0.1:3010/execute \
    HERMES_AGENT_MIDDLEWARE_RUNTIME_KIND=local-cli \
    HERMES_AGENT_CLI_ARGS_JSON=[\"--cli\",\"-z\",\"{prompt}\"] \
    HERMES_AGENT_CLI_INPUT_MODE=argument
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/control-plane/src/start-platform.mjs"]
