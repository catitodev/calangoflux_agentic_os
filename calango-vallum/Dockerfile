# ============================================================
# CalangoVallum — Security Module (Rust multi-stage build)
# Cloud Run compatible, read-only filesystem at runtime
# ============================================================

# Stage 1: Build
FROM rust:1.85-slim AS builder

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace-level files first for dependency caching
COPY Cargo.toml Cargo.lock ./
COPY ironclaw/Cargo.toml ironclaw/Cargo.toml
COPY calango-vallum/Cargo.toml calango-vallum/Cargo.toml

# Create dummy source files for dependency caching
RUN mkdir -p ironclaw/src && echo "fn main() {}" > ironclaw/src/main.rs \
    && mkdir -p calango-vallum/src && echo "fn main() {}" > calango-vallum/src/main.rs

# Build dependencies only (cached layer)
RUN cargo build --release --package calango-vallum 2>/dev/null || true

# Copy actual source code
COPY calango-vallum/src calango-vallum/src
COPY shared/ shared/

# Touch main.rs to invalidate the dummy build
RUN touch calango-vallum/src/main.rs

# Build the actual binary
RUN cargo build --release --package calango-vallum

# Stage 2: Runtime (distroless for minimal attack surface)
FROM gcr.io/distroless/cc-debian12:nonroot AS runtime

# Copy the compiled binary
COPY --from=builder /app/target/release/calango-vallum /app/calango-vallum

# distroless:nonroot runs as uid 65534 by default
USER nonroot:nonroot

# Cloud Run uses PORT env var
ENV PORT=8081
EXPOSE 8081

# Note: HEALTHCHECK not available in distroless (no shell).
# Cloud Run uses HTTP health checks configured in service YAML.

# Read-only filesystem: distroless is inherently immutable.
# No shell, no package manager, no writable layers.
# Cloud Run enforces --read-only flag in service config.

ENTRYPOINT ["/app/calango-vallum"]
