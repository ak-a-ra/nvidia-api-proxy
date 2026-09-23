# NVIDIA API Proxy Tech Stack

## Technology Stack

**Language**: JavaScript (ESM)
**Runtime**: Node.js >= 18.14
**Package Manager**: npm
**Test Runner**: Node built-in `node --test`

**Dependencies**: 0 (zero dependencies - Node built-ins only)

## Architecture Overview

The proxy follows a modular reverse proxy pattern with separation of concerns:

### Core Components

1. **Request Handler** (`server.js`)
   - Receives client requests
   - Validates authentication
   - Routes requests to upstream
   - Forwards responses back to clients

2. **Authentication Module**
   - SHA-256 token verification
   - `timingSafeEqual` for constant-time comparison
   - Client token → Proxy token validation
   - API key injection for upstream requests

3. **Upstream Handler**
   - HTTP client for NVIDIA NIM API
   - Duplex stream management (`duplex: "half"`)
   - Timeout handling (connect, idle)
   - Error handling and retries

4. **Response Processing**
   - Header fidelity preservation
   - Hop-by-hop header stripping
   - Cookie handling via `getSetCookie()`
   - Content encoding handling

## Key Design Decisions

### Zero Dependencies
- All functionality implemented using Node built-ins
- `fetch` for HTTP requests
- `crypto` for authentication
- `stream` for response handling
- No external packages for simplicity and security

### ESM Architecture
- Native ES modules for better tree-shaking
- Modern JavaScript features
- Node built-in module system

### Streaming First
- SSE responses pass through unbuffered
- Chunk-by-chunk processing
- Active streams never cut
- Idle windows reset per chunk

## Security Considerations

1. **Constant-time authentication**
   - SHA-256 with `timingSafeEqual`
   - No timing side channels
   - Length mismatch throws error

2. **Credential isolation**
   - Client tokens never reach upstream
   - API key stays server-side
   - Credential swap at request boundary

3. **Input validation**
   - Config validation with clear error messages
   - Whitespace-sensitive credential validation
   - No error message leakage

## Testing Strategy

### Test Architecture
- 33 tests in `server.test.js`
- Each test spawns isolated upstream stub
- Per-test environment configuration
- LIFO cleanup (proxy killed before stub closed)

### Upstream Stub Modes
- `sse`: Server-sent events simulation
- `stall`: Delayed response simulation
- `slowfinish`: Slow response completion
- `silent`: No response simulation
- `activelong`: Long-active streaming
- `midabort`: Mid-stream failure
- `abortable`: Aborted request handling

### Environment Configuration
- Env vars read at module import time
- Tests spawn child processes with per-test env
- `null` = "leave unset" sentinel
- Whitespace counts as missing credentials

## Performance Characteristics

### Streaming Performance
- Unbuffered upstream responses
- Chunk-by-chunk forwarding
- No response size limits
- Connection keep-alive support

### Timeout Management
- Connect timeout: 30 seconds (default)
- Idle timeout: 120 seconds (resets per chunk)
- Read timeout: configurable
- Graceful shutdown with 10s grace period

## Deployment Configuration

### Render Configuration
```yaml
environment:
  NVIDIA_BASE_URL: "https://integrate.api.nvidia.com/v1"
  NVIDIA_API_KEY: "your-secret-key"
  PROXY_AUTH_TOKEN: "client-facing-token"
  PORT: 3000
```

### Health Monitoring
- `/health` endpoint (no auth required)
- Distinguishes healthy vs unconfigured states
- Self-report capability

## Operational Considerations

### Monitoring
- No built-in monitoring (zero deps philosophy)
- Intended for deployment behind load balancers
- External monitoring recommended

### Scaling
- Horizontal scaling supported via multiple proxy instances
- No session state (stateless design)
- Connection pooling via HTTP keep-alive

### Maintenance
- Surgical patch philosophy
- Minimal code changes
- Comprehensive test coverage
- Clear error messages

## Future Evolution

### Potential Enhancements
- Rate limiting implementation
- Request logging (opt-in)
- Health checks for upstream
- Circuit breaker patterns
- Circuit breaker implementation

### Technical Debt
- None identified
- Zero dependencies reduces maintenance burden
- Modern ESM architecture