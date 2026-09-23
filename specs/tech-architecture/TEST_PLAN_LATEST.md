# NVIDIA API Proxy - Test Plan

## Overview

Comprehensive test plan for the NVIDIA NIM API reverse proxy. This plan defines testing strategy, coverage, and procedures to ensure the proxy meets all requirements and maintains high quality.

## Test Strategy

### Testing Approach

1. **Unit Testing**
   - Individual functions and modules
   - Authentication logic
   - Request/response processing
   - Configuration validation

2. **Integration Testing**
   - Component interactions
   - Authentication flow
   - Upstream communication
   - Header processing

3. **End-to-End Testing**
   - Complete request/response cycles
   - Real upstream integration (when available)
   - Client authentication scenarios
   - Error condition handling

### Testing Philosophy

#### Zero Dependency Testing
- All tests use Node built-in `node --test` runner
- No external test frameworks or libraries
- Tests spawn child processes for isolation
- Environment variables managed per test

#### Test Isolation
- Each test runs in isolated environment
- Upstream stub per test for predictable behavior
- LIFO cleanup (proxy killed before stub server)
- No state sharing between tests

#### Test Coverage
- 34 tests covering all major scenarios
- Each upstream stub mode tested
- Error conditions thoroughly tested
- Authentication scenarios covered

## Test Architecture

### Test Structure
```javascript
// server.test.js - Main test suite
import { test } from 'node:test';
import { equal, deepEqual, rejects } from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
```

### Test Helpers

#### Process Management
```javascript
const PROXY_BIN = join(process.cwd(), 'server.js');

async function startProxy(env) {
  const proxy = spawn('node', [PROXY_BIN], { env });
  // Wait for proxy to be ready
  return proxy;
}
```

#### Upstream Stubs
```javascript
const stubModes = {
  sse: 'Server-sent events simulation',
  stall: 'Delayed response simulation',
  slowfinish: 'Slow response completion',
  silent: 'No response simulation',
  activelong: 'Long-active streaming',
  midabort: 'Mid-stream failure',
  abortable: 'Aborted request handling'
};
```

### Test Configuration

#### Environment Variables
```javascript
const testEnv = {
  NVIDIA_BASE_URL: 'http://localhost:3000',
  NVIDIA_API_KEY: 'test-api-key',
  PROXY_AUTH_TOKEN: 'test-proxy-token',
  PORT: '0' // Let OS choose available port
};
```

#### Test Constants
```javascript
const CONSTANTS = {
  PROXY_TOKEN: 'test-proxy-token',
  API_KEY: 'test-api-key',
  BASE_URL: 'http://localhost:3000',
  TIMEOUT: 5000,
  HEALTH_ENDPOINT: '/health',
  INVALID_PATH: '/v1/invalid',
  MISSING_AUTH_HEADER: 'Bearer invalid-token'
};
```

## Test Coverage Matrix

### Upstream Stub Modes
| Mode | Description | Test Coverage |
|------|-------------|---------------|
| sse | Server-sent events simulation | Response streaming |
| stall | Delayed response simulation | Timeout handling |
| slowfinish | Slow response completion | Performance testing |
| silent | No response simulation | Error handling |
| activelong | Long-active streaming | Connection management |
| midabort | Mid-stream failure | Stream error handling |
| abortable | Aborted request handling | Client disconnect |

### Test Categories

#### Authentication Tests
- Valid token authentication
- Invalid token rejection
- Missing token handling
- Constant-time comparison verification
- Token edge cases (empty, malformed)

#### Request/Response Tests
- Basic request forwarding
- Path mapping validation
- Query parameter preservation
- Header fidelity testing
- Multi-value cookie handling

#### Error Handling Tests
- Invalid path responses
- Authentication failures
- Upstream connection failures
- Timeout scenarios
- Client disconnection

#### Performance Tests
- Streaming performance
- Connection reuse
- Memory usage
- Response time metrics

## Test Suite Details

### Test File Structure
```javascript
// server.test.js
import { test } from 'node:test';
import { equal, deepEqual, rejects } from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Test suites
test('Health endpoint', async () => { /* tests */ });
test('Authentication', async () => { /* tests */ });
test('Path mapping', async () => { /* tests */ });
// ... 30 more test suites
```

### Test Functions
Each test suite uses:
- `test()` for synchronous tests
- `test.todo()` for unimplemented tests
- `test.skip()` for temporarily disabled tests

### Test Helpers

#### Process Management
```javascript
async function withProxy(testEnv, testFn) {
  const proxy = await startProxy(testEnv);
  try {
    await testFn(proxy);
  } finally {
    proxy.kill();
    await waitForProxyCleanup();
  }
}
```

#### Upstream Stub Management
```javascript
class UpstreamStub {
  constructor(mode, port) {
    this.mode = mode;
    this.port = port;
    this.server = null;
  }

  async start() {
    // Start upstream stub based on mode
  }

  async stop() {
    // Stop upstream stub
  }
}
```

## Test Data

### Test Fixtures
```javascript
const fixtures = {
  validRequest: {
    headers: {
      'authorization': 'Bearer test-proxy-token',
      'content-type': 'application/json'
    },
    path: '/v1/chat/completions',
    body: { model: 'gpt-4', messages: [] }
  },

  invalidRequest: {
    headers: {
      'authorization': 'Bearer invalid-token'
    },
    path: '/v1/chat/completions'
  }
};
```

### Test Scenarios

#### Happy Path Tests
1. Health endpoint accessible
2. Valid authentication works
3. Request forwarded correctly
4. Response received correctly
5. Headers preserved
6. Cookies handled correctly

#### Error Path Tests
1. Invalid path returns 404
2. Missing auth returns 401
3. Invalid auth returns 401
4. Upstream connection failure returns 502
5. Timeout returns appropriate error
6. Client disconnect handled gracefully

## Test Validation

### Test Assertions
```javascript
// Positive assertions
equal(response.statusCode, 200);
deepEqual(response.headers, expectedHeaders);

// Negative assertions
rejects(async () => {
  await makeRequest('/invalid');
});
```

### Test Data Validation
- Request body integrity
- Response headers fidelity
- Cookie preservation
- Path mapping accuracy
- Query parameter preservation

## Test Maintenance

### Test Update Procedures
1. **Adding New Tests**
   - Add test to `server.test.js`
   - Ensure proper isolation
   - Update test count in README
   - Update AGENTS.md test count

2. **Modifying Tests**
   - Maintain test isolation
   - Update upstream stub modes if needed
   - Ensure test data validity

3. **Removing Tests**
   - Remove test code
   - Update test count references
   - Ensure remaining tests pass

### Test Quality Gates
- All 34 tests must pass
- No test failures in CI
- Test isolation maintained
- Performance within acceptable limits

## Test Reporting

### Test Output
```bash
node --test
# Output includes:
# - Test names
# - Pass/fail status
# - Timing information
# - Memory usage (if available)
```

### Test Metrics
- Test execution time
- Memory usage
- Test coverage (if applicable)
- Error rates
- Success rates

## Test Automation

### CI Integration
- Run `npm test` in CI pipeline
- Fail on test failures
- Record test metrics
- Upload test artifacts

### Local Testing
- Run `npm test` locally
- Run individual tests with `--test-name-pattern`
- Enable debug output for troubleshooting

## Test Future Enhancements

### Planned Test Improvements
1. **Test Coverage Expansion**
   - Add more authentication scenarios
   - Expand error condition testing
   - Add performance regression tests

2. **Test Optimization**
   - Reduce test execution time
   - Improve test isolation
   - Add parallel test execution

3. **Test Automation**
   - Automated test generation
   - Continuous test validation
   - Performance benchmarking

## Conclusion

This comprehensive test plan ensures the NVIDIA API Proxy meets all requirements and maintains high quality through thorough testing. The 34-test suite provides good coverage of all major scenarios while maintaining the zero-dependency philosophy.

Regular review and updates to this test plan are essential as new features are added and the system evolves.