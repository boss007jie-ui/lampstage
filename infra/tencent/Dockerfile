FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

# The repository contains the pinned provider adapter, while the Hypit CLI and
# its markup/media runtime are installed as the pinned public package.
RUN npm install --global --omit=dev @hypit/hypit@0.2.17

WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json ./apps/web/
RUN cd apps/web && npm ci
COPY apps/web ./apps/web
RUN cd apps/web/vendor/hypit && npm ci --omit=dev --ignore-scripts
RUN cd apps/web && npm run build

WORKDIR /app/apps/web
EXPOSE 3000
CMD ["npm", "run", "start"]
