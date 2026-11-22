# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# The SPA as static files behind nginx, with `/api` proxied to the API: ONE
# origin, which is what Front Door provides in production (docs/05-deployment.md).
#
# This image exists for the compose stack and the end-to-end tests. It is not a
# second deployable: production serves the same `dist/` from static hosting and
# lets Front Door do the routing this nginx does here.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

# Manifests only, so a source edit does not invalidate the dependency layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json    packages/contracts/
COPY tooling/eslint-config/package.json tooling/eslint-config/
COPY apps/web/package.json              apps/web/
RUN pnpm install --frozen-lockfile --filter @athlete/web...

# The bundler reads the contracts' TypeScript source (see vite.config.ts), so there is
# nothing to build first.
COPY tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/web ./apps/web
RUN pnpm --filter @athlete/web run build

# Unprivileged nginx: runs as a non-root user and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
