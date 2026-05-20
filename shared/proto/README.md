# Shared Proto Definitions

gRPC protocol buffer definitions shared across CalangoFlux Agentic OS services.

## Files

- `gateway.proto` — API Gateway service (public-facing endpoints)
- `agents.proto` — Inter-agent communication protocol

## Usage

### Rust (IronClaw, CalangoVallum)
Use `tonic-build` in `build.rs` to generate Rust code from these protos.

### Go (PicoClaw)
Use `protoc-gen-go` and `protoc-gen-go-grpc` to generate Go code.

### TypeScript (OpenClaw)
Use `@grpc/proto-loader` or `ts-proto` for TypeScript bindings.
