import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('DiTing plugin discovery environment', () => {
  const originalEnv = { ...process.env }
  let tempDir = ''

  beforeEach(() => {
    vi.resetModules()
    tempDir = mkdtempSync(join(tmpdir(), 'DiTing-plugins-env-'))
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  })

  it('uses the same venv python and agent root resolved from the DiTing binary as the bridge', async () => {
    const agentRoot = join(tempDir, 'agent')
    const venvBin = join(agentRoot, '.venv', 'bin')
    const DiTingCliDir = join(agentRoot, 'diting_cli')
    const captureFile = join(tempDir, 'capture.txt')
    const fakePython = join(venvBin, 'python')
    const fakeDiTing = join(venvBin, 'DiTing')

    mkdirSync(venvBin, { recursive: true })
    mkdirSync(DiTingCliDir, { recursive: true })
    writeFileSync(join(agentRoot, 'run_agent.py'), '')
    writeFileSync(join(DiTingCliDir, 'plugins.py'), '')
    writeFileSync(fakePython, [
      '#!/bin/sh',
      'printf "%s\\n%s\\n%s\\n%s\\n" "$0" "$1" "$2" "$DiTing_AGENT_ROOT_RESOLVED" > "$CAPTURE_FILE"',
      'printf "%s\\n" \'{"plugins":[],"warnings":[],"metadata":{"DiTingAgentRoot":"","pythonExecutable":"","cwd":"","projectPluginsEnabled":false}}\'',
      '',
    ].join('\n'))
    chmodSync(fakePython, 0o755)
    writeFileSync(fakeDiTing, `#!${fakePython}\n`)
    chmodSync(fakeDiTing, 0o755)

    delete process.env.DiTing_AGENT_ROOT
    delete process.env.DiTing_AGENT_BRIDGE_PYTHON
    delete process.env.DiTing_AGENT_BRIDGE_UV
    delete process.env.DiTing_PYTHON
    process.env.DiTing_HOME = join(tempDir, 'home')
    process.env.DiTing_BIN = fakeDiTing
    process.env.CAPTURE_FILE = captureFile

    const { listDiTingPlugins } = await import('../../packages/server/src/services/DiTing/plugins')
    await expect(listDiTingPlugins()).resolves.toMatchObject({ plugins: [] })

    const [command, firstArg, secondArg, resolvedRoot] = readFileSync(captureFile, 'utf8').trim().split('\n')
    expect(command).toBe(fakePython)
    expect(firstArg).toBe('-I')
    expect(secondArg).toBe('-c')
    expect(resolvedRoot).toBe(agentRoot)
  })

  it('uses package Python without isolated mode when no source root is resolved', async () => {
    const binDir = join(tempDir, 'bin')
    const captureFile = join(tempDir, 'capture-package.txt')
    const fakePython = join(binDir, 'python')
    const fakeDiTing = join(binDir, 'DiTing')

    mkdirSync(binDir, { recursive: true })
    writeFileSync(fakePython, [
      '#!/bin/sh',
      'printf "%s\\n%s\\n%s\\n%s\\n" "$0" "$1" "${PYTHONPATH-unset}" "${PYTHONHOME-unset}" > "$CAPTURE_FILE"',
      'printf "%s\\n" \'{"plugins":[],"warnings":[],"metadata":{"DiTingAgentRoot":"","pythonExecutable":"","cwd":"","projectPluginsEnabled":false}}\'',
      '',
    ].join('\n'))
    chmodSync(fakePython, 0o755)
    writeFileSync(fakeDiTing, `#!${fakePython}\n`)
    chmodSync(fakeDiTing, 0o755)

    delete process.env.DiTing_AGENT_ROOT
    delete process.env.DiTing_AGENT_BRIDGE_PYTHON
    delete process.env.DiTing_AGENT_BRIDGE_UV
    delete process.env.UV
    delete process.env.DiTing_PYTHON
    process.env.DiTing_HOME = join(tempDir, 'home')
    process.env.DiTing_BIN = fakeDiTing
    process.env.CAPTURE_FILE = captureFile
    process.env.PYTHONPATH = join(tempDir, 'shadow-path')
    process.env.PYTHONHOME = join(tempDir, 'shadow-home')

    const { listDiTingPlugins } = await import('../../packages/server/src/services/DiTing/plugins')
    await expect(listDiTingPlugins()).resolves.toMatchObject({ plugins: [] })

    const [command, firstArg, pythonPath, pythonHome] = readFileSync(captureFile, 'utf8').trim().split('\n')
    expect(command).toBe(fakePython)
    expect(firstArg).toBe('-c')
    expect(pythonPath).toBe('unset')
    expect(pythonHome).toBe('unset')
  })
})
