import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import {
  bundledAgentBrowserHome,
  bundledGit,
  bundledNode,
  bundledPython,
  gitPathDirs,
  DiTingBin,
  DiTingHome,
  nodeBinDir,
  pythonDir,
  webUiHome,
} from './paths'
import { DiTing_CLI_ARG } from './cli-constants'
import { ensureDesktopRuntime } from './runtime-manager'
import { resolveDesktopDiTingCliInvocation } from './DiTing-cli-invocation'

export function parseDiTingCliArgs(argv: string[] = process.argv): string[] | null {
  const index = argv.indexOf(DiTing_CLI_ARG)
  if (index < 0) return null
  return argv.slice(index + 1)
}

export async function runBundledDiTingCli(args: string[]): Promise<number> {
  try {
    await ensureDesktopRuntime()
  } catch (err) {
    console.error(`Failed to prepare DiTing runtime: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const DiTingCommand = DiTingBin()
  const pythonCommand = bundledPython()
  const invocation = resolveDesktopDiTingCliInvocation(process.platform, DiTingCommand, pythonCommand)
  if (!existsSync(DiTingCommand)) {
    console.error(`DiTing binary missing at ${DiTingCommand}`)
    console.error('Run: npm run prepare:runtime (to build a local DiTing runtime)')
    return 127
  }
  if (!existsSync(invocation.command)) {
    console.error(`DiTing CLI runtime missing at ${invocation.command}`)
    console.error('Run: npm run prepare:runtime (to build a local DiTing runtime)')
    return 127
  }

  mkdirSync(webUiHome(), { recursive: true })
  mkdirSync(DiTingHome(), { recursive: true })

  const binDir = dirname(DiTingCommand)
  const bundledNodeBin = nodeBinDir()
  const bundledAgentBrowserBin = process.platform === 'win32'
    ? join(pythonDir(), 'node')
    : join(pythonDir(), 'node', 'bin')
  const inheritedPath = process.env.PATH || process.env.Path || ''
  const pathValue = [
    binDir,
    bundledAgentBrowserBin,
    bundledNodeBin,
    gitPathDirs().join(delimiter),
    inheritedPath,
  ].filter(Boolean).join(delimiter)
  const gitBin = bundledGit()
  const browserExecutableOverride = process.env.AGENT_BROWSER_EXECUTABLE_PATH?.trim()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DiTing_DESKTOP: 'true',
    DiTing_BIN: DiTingCommand,
    DiTing_AGENT_BRIDGE_PYTHON: pythonCommand,
    DiTing_AGENT_CLI_PYTHON: pythonCommand,
    DiTing_AGENT_ROOT: pythonDir(),
    DiTing_AGENT_NODE: bundledNode(),
    DiTing_AGENT_NODE_ROOT: process.platform === 'win32' ? bundledNodeBin : dirname(bundledNodeBin),
    AGENT_BROWSER_HOME: process.env.AGENT_BROWSER_HOME?.trim() || bundledAgentBrowserHome(),
    ...(browserExecutableOverride ? { AGENT_BROWSER_EXECUTABLE_PATH: browserExecutableOverride } : {}),
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || join(pythonDir(), 'ms-playwright'),
    ...(gitBin ? { DiTing_AGENT_GIT: gitBin } : {}),
    DiTing_HOME: DiTingHome(),
    DiTing_WEB_UI_HOME: webUiHome(),
    DiTing_WEBUI_STATE_DIR: webUiHome(),
    PATH: pathValue,
  }

  return await new Promise(resolve => {
    const child = spawn(invocation.command, [...invocation.argsPrefix, ...args], {
      env,
      stdio: 'inherit',
      windowsHide: false,
    })
    child.once('error', (err) => {
      console.error(`Failed to run bundled DiTing CLI: ${err.message}`)
      resolve(1)
    })
    child.once('exit', (code, signal) => {
      if (typeof code === 'number') {
        resolve(code)
        return
      }
      console.error(`Bundled DiTing CLI exited from signal ${signal || 'unknown'}`)
      resolve(1)
    })
  })
}
