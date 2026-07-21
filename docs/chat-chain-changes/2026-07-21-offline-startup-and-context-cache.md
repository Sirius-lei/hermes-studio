---
date: 2026-07-21
commit: pending
feature: offline deployment startup and Bridge context estimation cache
impact: Air-gapped deployments no longer trigger optional catalog, update, tirith, or lazy-package downloads; normal chat runs reuse fixed Bridge context overhead instead of probing it before every message.
---

# Offline startup and context cache

Touched: server startup catalog/update paths, bundled DiTing runtime download
guards, Docker deployment files, and the chat-run Bridge context estimator.

## Behavior impact

- `DiTing_OFFLINE=1` disables optional remote model catalogs and update checks.
- Missing `tirith` and optional backend dependencies no longer trigger GitHub or
  PyPI downloads in offline mode.
- The configured model endpoint remains available for actual inference.
- Fixed system/tool context overhead is cached per session/model/profile instead
  of being re-estimated before every chat run.

## Validation

- Focused server and runtime tests for model catalogs, health checks, tirith,
  lazy dependencies, and Bridge chat runs.
- `npm run build`
- `npm run harness:check`
