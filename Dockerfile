# ──────────────────────────────────────────────────────────────
# Multi-stage Dockerfile for ekyc-api (NestJS)
# Face recognition is handled by CompreFace (external service)
# ──────────────────────────────────────────────────────────────

# ── Stage 1: Build ────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies
RUN npm prune --omit=dev

# Strip junk from node_modules
RUN find node_modules \( \
      -name "*.md" -o -name "*.markdown" -o \
      -name "*.ts" ! -name "*.d.ts" -o \
      -name "*.map" -o \
      -name "LICENSE*" -o -name "CHANGELOG*" -o -name "HISTORY*" -o \
      -name ".npmignore" -o -name ".eslintrc*" -o \
      -name "example" -o -name "examples" -o -name "test" -o -name "tests" -o \
      -name "__tests__" -o -name "docs" -o -name "doc" \
    \) -prune -exec rm -rf {} + 2>/dev/null; exit 0

# ── Stage 2: Production runtime ───────────────────────────────
FROM node:22-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
  && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd --gid 1001 nestjs \
  && useradd --uid 1001 --gid nestjs --shell /bin/sh --create-home nestjs

COPY --from=builder --chown=nestjs:nestjs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nestjs /app/dist          ./dist
COPY --from=builder --chown=nestjs:nestjs /app/package.json   ./package.json

COPY --chown=nestjs:nestjs public/ ./public/

USER nestjs

ENV PORT=2000
EXPOSE 2000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${PORT}/ || exit 1

CMD ["node", "dist/main"]
