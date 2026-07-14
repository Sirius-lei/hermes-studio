import { execFile, spawn } from 'child_process'
import type { ChildProcess, ExecFileOptions, SpawnOptions } from 'child_process'
import { existsSync } from 'fs'
import { basename, dirname, resolve } from 'path'
import { getDiTingBin } from './DiTing-path'

export interface DiTingInvocation {
  command: string
  argsPrefix: string[]
}

export interface DiTingExecResult {
  stdout: string
  stderr: string
}

export function resolveDiTingBin(customBin?: string): string {
  return getDiTingBin(customBin)
}

interface WindowsBundledCli {
  python: string
  moduleName: string
}

function bundledCliPythonForWindows(DiTingBin: string): WindowsBundledCli | null {
  const envPython = process.env.DiTing_AGENT_CLI_PYTHON?.trim()
  const basenameLower = basename(DiTingBin).toLowerCase()
  const moduleName = 'DiTing_cli.main'
  if (envPython) return { python: envPython, moduleName }

  if (basenameLower !== 'diting.exe') return null
  const python = resolve(dirname(DiTingBin), '..', 'python.exe')
  return existsSync(python) ? { python, moduleName } : null
}

function withWindowsHide<T extends ExecFileOptions | SpawnOptions>(options?: T): T {
  if (process.platform !== 'win32') return (options || {}) as T
  return { windowsHide: true, ...(options || {}) } as T
}

export function resolveDiTingInvocation(DiTingBin = resolveDiTingBin()): DiTingInvocation {
  if (process.platform === 'win32') {
    const bundled = bundledCliPythonForWindows(DiTingBin)
    if (bundled) return { command: bundled.python, argsPrefix: ['-m', bundled.moduleName] }
  }

  return { command: DiTingBin, argsPrefix: [] }
}

export function execDiTingWithBin(
  DiTingBin: string,
  args: readonly string[],
  options?: ExecFileOptions,
): Promise<DiTingExecResult> {
  const invocation = resolveDiTingInvocation(DiTingBin)
  return new Promise((resolveExec, rejectExec) => {
    execFile(
      invocation.command,
      [...invocation.argsPrefix, ...args],
      { ...withWindowsHide(options), encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          rejectExec(Object.assign(error, { stdout, stderr }))
          return
        }
        resolveExec({ stdout: String(stdout || ''), stderr: String(stderr || '') })
      },
    )
  })
}

export function execDiTing(args: readonly string[], options?: ExecFileOptions) {
  return execDiTingWithBin(resolveDiTingBin(), args, options)
}

export function spawnDiTingWithBin(
  DiTingBin: string,
  args: readonly string[],
  options?: SpawnOptions,
): ChildProcess {
  const invocation = resolveDiTingInvocation(DiTingBin)
  return spawn(invocation.command, [...invocation.argsPrefix, ...args], withWindowsHide(options))
}

export function spawnDiTing(args: readonly string[], options?: SpawnOptions): ChildProcess {
  return spawnDiTingWithBin(resolveDiTingBin(), args, options)
}
