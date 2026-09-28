FROM node:22.14.0-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && mkdir -p /data && chown node:node /data
ENV NODE_ENV=production APP_ENV=production DEV_LOCAL_AUTH=false SERVE_WEB=true OBJECT_STORAGE_LOCAL_ROOT=/data/audio
CMD ["node", "--import", "tsx", "scripts/container-entry.ts"]
