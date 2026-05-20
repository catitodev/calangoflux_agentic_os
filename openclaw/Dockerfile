# ============================================================
# OpenClaw — External Action Executor (Node.js slim)
# Cloud Run compatible, read-only filesystem at runtime
# ============================================================

# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files for dependency caching
COPY package.json package-lock.json* ./

# Install all dependencies (including dev for build)
RUN npm ci --ignore-scripts

# Copy source code
COPY tsconfig.json ./
COPY src/ src/

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:20-slim AS runtime

RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -r -s /bin/false -u 1001 appuser

WORKDIR /app

# Copy package files and install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Set ownership
RUN chown -R appuser:appuser /app

# Run as non-root user
USER appuser

# Cloud Run uses PORT env var
ENV PORT=8083
ENV NODE_ENV=production
EXPOSE 8083

# Health check for Cloud Run compatibility
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Read-only filesystem: no writes needed at runtime
# Cloud Run enforces this via --read-only flag in service config

ENTRYPOINT ["node", "dist/index.js"]
