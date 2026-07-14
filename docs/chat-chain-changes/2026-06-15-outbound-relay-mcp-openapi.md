---
date: 2026-06-15
pr: pending
feature: DiTing MCP OpenAPI relay
impact: Model-run auth now writes profile-scoped temporary tokens for the bundled MCP server, and chat/coding-agent runs rely on OpenAPI-guided DiTing API calls instead of embedding bearer tokens in prompts.
---

Bridge, group-chat, and coding-agent runs continue to receive DiTing MCP
guidance, but model-run authentication is now stored in the Web UI profile token
file for the bundled MCP server to read. This avoids placing transient bearer
tokens in model instructions while preserving profile-scoped DiTing API access
for MCP tool calls.
