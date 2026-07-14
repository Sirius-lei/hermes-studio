---
date: 2026-07-13
pr: pending
commit: pending
feature: DiTing runtime compatibility and chat display
impact: The DiTing UI uses DiTing-only runtime names, starts without eager bridge warmup by default, and renders each assistant response once.
---

The runtime boundary now uses DiTing CLI, Agent Bridge, home-directory, and Python-module names throughout the repository. Bridge worker warmup is opt-in through `DiTing_AGENT_BRIDGE_WARM_PROFILES`, and plain assistant text is rendered by a single mutually exclusive `MessageItem` branch.
