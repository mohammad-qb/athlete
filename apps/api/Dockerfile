# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# The deployable. One image, built once, run identically in dev, staging, prod
# and -- when the budget is cut or the brief demands a single server -- under
# docker compose on one VM. That portability is why several architectural choices
# earlier in the design were made the way they were.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

# Manifests only, so a source edit does not invalidate the dependency layer.
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json    packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json           apps/api/

# ---------- build (all dependencies) ----------
FROM manifests AS build
# --frozen-lockfile so a drifted lockfile fails the build rather than quietly
# resolving versions CI never tested.
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @athlete/config --filter @athlete/contracts run build \
 && pnpm --filter @athlete/api run build

# ---------- production dependencies only ----------
# A separate install rather than pruning the build stage: `pnpm prune --prod` purges
# and does not recreate the modules directory in a workspace, and `pnpm deploy` needs
# injected workspace packages from pnpm v10 -- which would cost local developers their
# symlinked packages. A clean --prod install sidesteps both.
FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod

# Compiled output only. No TypeScript, no vitest, no testcontainers, no test files.
COPY --from=build /repo/packages/config/dist    ./packages/config/dist
COPY --from=build /repo/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /repo/apps/api/dist           ./apps/api/dist
# Migrations ship with the image so the CI migration job runs exactly the SQL this
# image expects -- but they execute as their OWN step before the deploy, never at
# container start, where two booting replicas would race each other.
COPY apps/api/drizzle ./apps/api/drizzle

# ---------- runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps

# The workspace is copied whole so pnpm's symlinks
# (apps/api/node_modules/@athlete/* -> ../../packages/*) still resolve.
COPY --from=prod-deps /repo /app
WORKDIR /app/apps/api

# Non-root; `node` already exists in the base image.
USER node

EXPOSE 3000

# Exec form, so PID 1 is node: SIGTERM reaches it and in-flight requests drain.
CMD ["node", "dist/main.js"]
