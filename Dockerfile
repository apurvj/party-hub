# Dockerfile for the Party Hub WebSocket server (used by Fly.io).
# Multi-stage: install with pnpm, build shared types, run the server with tsx.
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# --- deps: install with the lockfile for reproducible builds ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/frontend/package.json packages/frontend/
# Frontend isn't needed at runtime, but its manifest is present for the workspace
# graph; --ignore-scripts keeps the image lean (no native rebuilds needed for tsx).
RUN pnpm install --frozen-lockfile --config.strict-dep-builds=false --filter @party-hub/server... --filter @party-hub/shared...

# --- build shared types + copy source ---
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
RUN pnpm --filter @party-hub/shared run build

# --- runtime ---
FROM build AS runtime
ENV NODE_ENV=production
EXPOSE 3001
CMD ["pnpm", "--filter", "@party-hub/server", "run", "start"]
