# The deployed demo: the web app built with the LLM features disabled, served with the API by
# intelmonitor.server.site. Deploy with scripts/deploy.sh, which also ships the store on --data.

FROM node:22-slim AS web
WORKDIR /app/web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN VITE_API_URL=/api VITE_LLM_OFF=1 pnpm exec vite build

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
WORKDIR /app/api
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY api/pyproject.toml api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY api/ ./
RUN uv sync --frozen --no-dev
COPY --from=web /app/web/dist /app/web/dist
# The store to start from: empty unless deploy.sh --data put one in deploy/seed.
COPY deploy/ /app/deploy/
ENV INTELMONITOR_DATA_DIR=/data
CMD ["/app/deploy/start.sh"]
