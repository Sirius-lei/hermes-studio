---
date: 2026-07-14
commit: pending
feature: DiTing Bridge startup latency and managed MCP cleanup
impact: Local startup no longer waits five seconds on a missing or stale IPC Bridge, and obsolete Web UI-managed MCP entries are removed before synchronization.
---

# DiTing Bridge startup latency

Touched: Bridge process manager, Studio MCP autoinjection, and focused server tests.

## Behavior impact

- A missing local IPC socket skips the reusable-bridge probe immediately.
- A stale local IPC socket is probed for 250 ms before a replacement Bridge starts.
- Obsolete Web UI-managed MCP entries from earlier namespaces are removed before the current managed entries are synchronized.
- Surviving Bridge processes still attach immediately, and TCP endpoints keep the existing five-second attach window.

## Validation

- `npx vitest run tests/server/agent-bridge-manager.test.ts tests/server/studio-mcp-autoinject.test.ts`
- `npm run harness:check`
- Local cold-start and first-response latency probes against the configured provider
