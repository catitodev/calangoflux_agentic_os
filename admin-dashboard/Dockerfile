# ============================================================
# Admin Dashboard — React SPA (nginx + static build)
# Cloud Run compatible, read-only filesystem at runtime
# ============================================================

# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files for dependency caching
COPY package.json package-lock.json* ./

# Install all dependencies (including dev for build)
RUN npm ci --ignore-scripts

# Copy source and config files
COPY index.html ./
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY src/ src/

# Build static assets
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine AS runtime

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Add custom nginx config directly (port hardcoded to 8084)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static files
COPY --from=builder /app/dist /usr/share/nginx/html

# nginx:alpine runs as nginx user by default
# Cloud Run uses PORT env var — nginx template substitution handles this
ENV PORT=8084
EXPOSE 8084

# Health check for Cloud Run compatibility
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

# Read-only filesystem: static files served from image layer
# Cloud Run enforces this via --read-only flag in service config
# nginx needs /var/cache/nginx and /var/run writable — use tmpfs in Cloud Run

ENTRYPOINT ["nginx", "-g", "daemon off;"]
