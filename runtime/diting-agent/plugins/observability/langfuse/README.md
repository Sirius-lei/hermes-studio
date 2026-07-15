# Langfuse Observability Plugin

This plugin ships bundled with DiTing but is **opt-in** — it only loads when
you explicitly enable it.

## Enable

Pick one:

```bash
# Interactive: walks you through credentials + SDK install + enable
diting tools  # → Langfuse Observability

# Manual
pip install langfuse
diting plugins enable observability/langfuse
```

## Required credentials

Set these in `~/.diting/.env` (or via `diting tools`):

```bash
DiTing_LANGFUSE_PUBLIC_KEY=pk-lf-...
DiTing_LANGFUSE_SECRET_KEY=sk-lf-...
DiTing_LANGFUSE_BASE_URL=https://cloud.langfuse.com   # or your self-hosted URL
```

Without the SDK or credentials the hooks no-op silently — the plugin fails
open.

## Verify

```bash
diting plugins list                 # observability/langfuse should show "enabled"
diting chat -q "hello"              # then check Langfuse for a "DiTing turn" trace
```

## Optional tuning

```bash
DiTing_LANGFUSE_ENV=production       # environment tag
DiTing_LANGFUSE_RELEASE=v1.0.0       # release tag
DiTing_LANGFUSE_SAMPLE_RATE=0.5      # sample 50% of traces
DiTing_LANGFUSE_MAX_CHARS=12000      # max chars per field (default: 12000)
DiTing_LANGFUSE_DEBUG=true           # verbose plugin logging
```

## Disable

```bash
diting plugins disable observability/langfuse
```
