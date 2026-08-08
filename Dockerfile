# Dockerfile for the Party Hub WebSocket server (used by Fly.io).
# Multi-stage: install with pnpm, build shared types, run the server with tsx.
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# pnpm 11 hard-errors when a dep build script is ignored, and every `pnpm run`
# re-verifies deps first (re-triggering it). esbuild (via tsx) hits this. These
# clear both gates for install AND the `pnpm run start` CMD. Safe: esbuild ships
# its binary via lockfile-pinned platform packages, so the skipped script is a no-op.
ENV PNPM_CONFIG_STRICT_DEP_BUILDS=false
ENV PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false
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
RUN pnpm install --frozen-lockfile --filter @party-hub/server... --filter @party-hub/shared...

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
