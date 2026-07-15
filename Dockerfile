# ──────────────────────────────────────────────────────────────
# Multi-stage Dockerfile for ekyc-api (NestJS + TensorFlow.js + Canvas)
# Optimised for size: ~500 MB vs 1.54 GB
# ──────────────────────────────────────────────────────────────

# ── Stage 1: Install dependencies & build ────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# System libs needed to compile canvas native module
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libcairo2-dev \
    libjpeg62-turbo-dev \
    libpango1.0-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*

# Copy manifests first → maximise Docker layer cache
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts=false

# Copy source & build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies
RUN npm prune --omit=dev

# ── Aggressive cleanup: strip junk from production node_modules ──
RUN find node_modules \( \
      -name "*.md" -o -name "*.markdown" -o \
      -name "*.ts" ! -name "*.d.ts" -o \
      -name "*.map" -o \
      -name "LICENSE*" -o -name "CHANGELOG*" -o -name "HISTORY*" -o \
      -name ".npmignore" -o -name ".eslintrc*" -o \
      -name ".travis.yml" -o -name ".github" -o \
      -name "Makefile" -o -name "Gruntfile.js" -o -name "Gulpfile.js" -o \
      -name "example" -o -name "examples" -o -name "test" -o -name "tests" -o \
      -name "__tests__" -o -name "docs" -o -name "doc" \
    \) -prune -exec rm -rf {} + 2>/dev/null; exit 0

# ── Shim: face-api hardcodes require('tfjs-node'), redirect to pure-JS tfjs ──
RUN mkdir -p node_modules/@tensorflow/tfjs-node && \
    echo "module.exports = require('@tensorflow/tfjs');" > node_modules/@tensorflow/tfjs-node/index.js && \
    echo '{"name":"@tensorflow/tfjs-node","version":"0.0.0","main":"index.js"}' > node_modules/@tensorflow/tfjs-node/package.json

# ── Stage 2: Production runtime ─────────────────────────────
FROM node:20-slim AS runner

WORKDIR /app

# Runtime-only native libraries (no compilers, minimal footprint)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libjpeg62-turbo \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgif7 \
    librsvg2-2 \
    libpixman-1-0 \
    curl \
  && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --gid 1001 nestjs \
  && useradd --uid 1001 --gid nestjs --shell /bin/sh --create-home nestjs

# Copy only what we need from builder
COPY --from=builder --chown=nestjs:nestjs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nestjs /app/dist          ./dist
COPY --from=builder --chown=nestjs:nestjs /app/package.json   ./package.json

# Copy static assets & ML models (required at runtime)
COPY --chown=nestjs:nestjs models/ ./models/
COPY --chown=nestjs:nestjs public/ ./public/

USER nestjs

ENV PORT=2000
EXPOSE 2000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${PORT}/ || exit 1

CMD ["node", "dist/main"]
