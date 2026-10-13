FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Mainland-China CVMs can reach the upstream Debian and npm hosts, but far too
# slowly to be practical. Measured on a Tencent CVM in this project's VPC:
#
#   deb.debian.org              1.35 MB/s     mirrors.cloud.tencent.com/debian  39.3 MB/s
#   registry.npmjs.org          216 KB/s      mirrors.cloud.tencent.com/npm     1.39 MB/s
#
# Installing ffmpeg plus a full Next.js dependency tree over the upstream hosts
# turned the build into a 40-minute wait. Both arguments default to empty, which
# keeps the upstream sources for builds outside mainland China;
# bootstrap-ubuntu.sh probes the mirrors and passes them only when they answer.
#
#   DEBIAN_MIRROR  base URL replacing http://deb.debian.org, e.g.
#                  http://mirrors.cloud.tencent.com  (must also serve
#                  /debian-security — the same host prefix covers both suites)
#   NPM_REGISTRY   registry base URL, e.g. https://mirrors.cloud.tencent.com/npm
#
# Set either to an empty value to opt out even on a mainland host.
ARG DEBIAN_MIRROR=""
ARG NPM_REGISTRY=""

RUN if [ -n "$DEBIAN_MIRROR" ]; then \
      if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
      else \
        echo "WARNING: DEBIAN_MIRROR is set but /etc/apt/sources.list.d/debian.sources is missing; using upstream apt sources." >&2; \
      fi; \
    fi \
 && apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

# Persist the registry in /root/.npmrc so every later npm invocation uses it.
# npm's default replace-registry-host=npmjs rewrites the registry.npmjs.org
# hosts recorded in the lockfiles to whatever registry is configured, so
# `npm ci` follows NPM_REGISTRY as well.
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
  && npm install --global --omit=dev @hypit/hypit@0.2.17

WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json ./apps/web/
# Next builds with TypeScript/Tailwind, and the production worker runs through
# tsx (currently a devDependency). Keep those packages in the runtime image.
RUN cd apps/web && npm ci --include=dev
COPY apps/web ./apps/web
RUN cd apps/web/vendor/hypit && npm ci --omit=dev --ignore-scripts
RUN cd apps/web && npm run build

WORKDIR /app/apps/web
EXPOSE 3000
CMD ["npm", "run", "start"]
