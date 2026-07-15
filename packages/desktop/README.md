# DiTing Studio

Electron desktop distribution for DiTing Studio.

## Install

Download the latest macOS, Windows, or Linux installer for your CPU
architecture from the project
[GitHub Releases](https://github.com/EKKOLearnAI/DiTing-studio/releases/latest).

The desktop app bundles the Web UI runtime and launches it locally from the
native shell app.

## Command shims

After the packaged desktop app starts, it installs managed command shims:

| Command | Description |
| --- | --- |
| `DiTing-studio` | Open the DiTing Studio desktop app |
| `DiTing-studio cli ...` | Run the bundled DiTing Agent CLI |
| `DiTing-studio web ...` | Run the bundled `diting-web-ui` command |
| `DiTing-studio -h` | Show wrapper help |
| `diting-studio-mcp` | Run the managed Web UI MCP bridge |

Use `DiTing-studio cli -h` for DiTing Agent CLI help and
`DiTing-studio web -h` for Web UI CLI help.

## Data directories

DiTing Agent data is stored in the same platform-specific location as native
DiTing installs:

- Windows: `%LOCALAPPDATA%\DiTing` (falls back to `%APPDATA%\DiTing`)
- macOS/Linux: `~/.diting`

The desktop wrapper's own Web UI state is stored separately in
`~/.diting-web-ui` unless `DiTing_WEB_UI_HOME` is set.

## China mirror environment

These mirrors are optional and are not required in CI:

```sh
export NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

If GitHub release downloads are slow, `fetch-python.mjs` can also use a compatible
python-build-standalone release mirror:

```sh
export PBS_BASE_URL=https://github.com/astral-sh/python-build-standalone/releases/download
```
