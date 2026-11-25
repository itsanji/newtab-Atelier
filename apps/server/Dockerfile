# Build from the repository root: docker build -f apps/server/Dockerfile .
FROM oven/bun:1.4.4-alpine
WORKDIR /app

# Dependencies first, so source edits do not reinstall. The extension manifest is only here so the
# workspace lockfile matches; its dependencies are not installed (--filter).
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/extension/package.json apps/extension/package.json
RUN bun install --frozen-lockfile --production --filter @atelier/server

COPY packages/core packages/core
COPY apps/server/src apps/server/src
COPY apps/server/migrations apps/server/migrations
COPY apps/server/static apps/server/static

ENV NODE_ENV=production
USER bun
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-8787}/health" || exit 1
CMD ["bun", "apps/server/src/main.ts"]
