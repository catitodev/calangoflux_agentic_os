# ============================================================
# PicoClaw — Ultra-lightweight Task Router (Go multi-stage)
# Target: <10MB final image, <1s startup
# Cloud Run compatible, read-only filesystem at runtime
# ============================================================

# Stage 1: Build
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /app

# Copy go module files for dependency caching
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true

# Copy source code
COPY . .

# Build static binary with all optimizations for minimal size
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-s -w -extldflags '-static'" \
    -trimpath \
    -o picoclaw \
    .

# Stage 2: Runtime (scratch for minimal image <10MB)
FROM scratch

# Import CA certificates for HTTPS connections
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

# Copy the static binary
COPY --from=builder /app/picoclaw /picoclaw

# Cloud Run uses PORT env var
ENV PORT=8082
EXPOSE 8082

# Note: HEALTHCHECK not supported in scratch images.
# Cloud Run uses HTTP health checks configured in service YAML.

# Read-only filesystem: scratch is inherently immutable
# No shell, no package manager, no writable layers

ENTRYPOINT ["/picoclaw"]
