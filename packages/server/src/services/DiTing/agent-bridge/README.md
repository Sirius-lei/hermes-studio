# Agent Bridge

Optional backend-side bridge for talking to DiTing Agent by instantiating
`run_agent.AIAgent` directly in a Python process.

This is intentionally separate from the current Web UI chat path.

## Python Service

Python bridge code lives under `python/` so it stays separate from the Node/TS
bridge client and manager code. The executable entrypoint is
`python/DiTing_bridge.py`, and the implementation is split across sibling
Python modules:

- `bridge_runtime.py` - environment, config, import discovery, JSON helpers.
- `bridge_pool.py` - in-process agent sessions, runs, callbacks, approvals.
- `bridge_server.py` - worker-side request handling.
- `bridge_transport.py` - socket protocol and worker process helpers.
- `bridge_broker.py` - broker-side profile worker routing.

```bash
python packages/server/src/services/DiTing/agent-bridge/python/DiTing_bridge.py
```

Default endpoint:

```text
ipc:///tmp/DiTing-agent-bridge.sock
```

On Windows, the default endpoint is TCP because Python may not support Unix
domain sockets there:

```text
tcp://127.0.0.1:18765
```

Override with:

```bash
DiTing_AGENT_BRIDGE_ENDPOINT=tcp://127.0.0.1:8765 python packages/server/src/services/DiTing/agent-bridge/python/DiTing_bridge.py
```

Profile workers use the same platform defaults: TCP on Windows and IPC on
macOS/Linux. Override worker transport with:

```bash
DiTing_AGENT_BRIDGE_WORKER_TRANSPORT=tcp DiTing_AGENT_BRIDGE_WORKER_PORT_BASE=18780 python packages/server/src/services/DiTing/agent-bridge/python/DiTing_bridge.py
```

The service discovers DiTing Agent in this order:

1. `--agent-root`
2. `DiTing_AGENT_ROOT`
3. the installed `DiTing` command path
4. current working directory and parent directories
5. common locations such as `~/.DiTing/DiTing-agent`, `~/DiTing-agent`, and `/opt/DiTing-agent`
6. the `DiTing-agent` package installed in the selected Python environment

DiTing home is resolved from `--DiTing-home`, `DiTing_HOME`, then `~/.DiTing`.

Default agent root:

```text
~/.DiTing/DiTing-agent
```

You can pass both paths explicitly:

```bash
python packages/server/src/services/DiTing/agent-bridge/python/DiTing_bridge.py \
  --agent-root ~/.DiTing/DiTing-agent \
  --DiTing-home ~/.DiTing
```

If no source checkout containing `run_agent.py` is found, the bridge falls back
to importing `run_agent` from the Python environment. This supports package
installs such as `pip install DiTing-agent`. The Node manager prefers the source
checkout's virtualenv when a checkout exists, then the Python interpreter from
the installed `DiTing` command, then the system Python.

The socket transport uses Python and Node standard libraries. No ZMQ dependency
is required.

## Backend Usage

```ts
import { AgentBridgeClient } from './services/DiTing/agent-bridge'

const bridge = new AgentBridgeClient()
const run = await bridge.chat(sessionId, message)

for await (const chunk of bridge.streamOutput(run.run_id)) {
  if (chunk.delta) {
    // forward chunk.delta to Socket.IO/SSE/etc.
  }
}
```

The external chat call only sends `session_id` and `message`. Provider, model,
keys, tools, reasoning, and session DB are resolved by DiTing-agent from the
normal DiTing config and environment.

The bridge instantiates `AIAgent` with `platform="cli"` by default so behavior
matches CLI chat. Override it only if a caller intentionally needs a distinct
platform identity:

```bash
DiTing_AGENT_BRIDGE_PLATFORM=agent-bridge python packages/server/src/services/DiTing/agent-bridge/python/DiTing_bridge.py
```
