---
date: 2026-06-11
pr: 1487
feature: Coding agent resume bridge checks
impact: Coding agent session resume no longer depends on DiTing worker status lookup, while DiTing worker-backed sessions still attempt bridge reattach.
---

Transient DiTing bridge status lookup timeouts during resume are logged at debug level instead of being emitted as user-visible reattach warnings.
