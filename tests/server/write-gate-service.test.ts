import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const originalDiTingHome = process.env.DiTing_HOME
const originalDiTingAgentRoot = process.env.DiTing_AGENT_ROOT
const originalDiTingBin = process.env.DiTing_BIN
const originalDiTingAgentCliPython = process.env.DiTing_AGENT_CLI_PYTHON
let DiTingHome = ''

async function loadService() {
  vi.resetModules()
  process.env.DiTing_HOME = DiTingHome
  return import('../../packages/server/src/services/DiTing/write-gate')
}

beforeEach(async () => {
  DiTingHome = await mkdtemp(join(tmpdir(), 'DiTing-write-gate-'))
})

afterEach(async () => {
  vi.resetModules()
  if (originalDiTingHome === undefined) delete process.env.DiTing_HOME
  else process.env.DiTing_HOME = originalDiTingHome
  if (originalDiTingAgentRoot === undefined) delete process.env.DiTing_AGENT_ROOT
  else process.env.DiTing_AGENT_ROOT = originalDiTingAgentRoot
  if (originalDiTingBin === undefined) delete process.env.DiTing_BIN
  else process.env.DiTing_BIN = originalDiTingBin
  if (originalDiTingAgentCliPython === undefined) delete process.env.DiTing_AGENT_CLI_PYTHON
  else process.env.DiTing_AGENT_CLI_PYTHON = originalDiTingAgentCliPython
  await rm(DiTingHome, { recursive: true, force: true })
  DiTingHome = ''
})

describe('write gate service', () => {
  it('lists pending memory and skill records from the active profile', async () => {
    await mkdir(join(DiTingHome, 'pending', 'memory'), { recursive: true })
    await mkdir(join(DiTingHome, 'pending', 'skills'), { recursive: true })
    await writeFile(join(DiTingHome, 'pending', 'memory', 'mem123.json'), JSON.stringify({
      id: 'mem123',
      subsystem: 'memory',
      action: 'add',
      summary: 'remember concise answers',
      origin: 'foreground',
      created_at: 2,
      payload: { target: 'user' },
    }), 'utf-8')
    await writeFile(join(DiTingHome, 'pending', 'skills', 'skill123.json'), JSON.stringify({
      id: 'skill123',
      subsystem: 'skills',
      action: 'patch',
      summary: 'patch demo skill',
      origin: 'background_review',
      created_at: 1,
      payload: { name: 'demo' },
    }), 'utf-8')

    const { listPendingWrites } = await loadService()
    const result = await listPendingWrites('default')

    expect(result.counts).toEqual({ memory: 1, skills: 1 })
    expect(result.records.map(record => record.id)).toEqual(['skill123', 'mem123'])
    expect(result.records[0]).toMatchObject({
      subsystem: 'skills',
      summary: 'patch demo skill',
      payload: { name: 'demo' },
    })
  })

  it('rejects unsafe subsystem and pending ids before running DiTing Python', async () => {
    const { getPendingWriteDiff } = await loadService()

    await expect(getPendingWriteDiff('default', 'files', 'abc123')).rejects.toThrow('Invalid write gate subsystem')
    await expect(getPendingWriteDiff('default', 'memory', '../abc')).rejects.toThrow('Invalid pending write id')
  })

  it('detects write approval support from a uv-backed DiTing venv shebang', async () => {
    const agentRoot = join(DiTingHome, 'agent')
    const venvBin = join(agentRoot, 'venv', 'bin')
    const externalPythonDir = join(DiTingHome, 'uv-python', 'bin')
    await mkdir(join(agentRoot, 'tools'), { recursive: true })
    await mkdir(join(agentRoot, 'diting_cli'), { recursive: true })
    await mkdir(venvBin, { recursive: true })
    await mkdir(externalPythonDir, { recursive: true })
    await writeFile(join(agentRoot, 'tools', 'write_approval.py'), '', 'utf-8')
    await writeFile(join(agentRoot, 'diting_cli', 'write_approval_commands.py'), '', 'utf-8')
    await writeFile(join(externalPythonDir, 'python3'), '', 'utf-8')
    await symlink(join(externalPythonDir, 'python3'), join(venvBin, 'python3'))

    const DiTingBin = join(venvBin, 'DiTing')
    await writeFile(DiTingBin, `#!${join(venvBin, 'python3')}\n`, 'utf-8')
    process.env.DiTing_BIN = DiTingBin
    delete process.env.DiTing_AGENT_ROOT

    const { isWriteGateSupported } = await loadService()

    expect(isWriteGateSupported()).toBe(true)
  })

  it('detects write approval support from a Windows-style venv Scripts executable path', async () => {
    const agentRoot = join(DiTingHome, 'agent-win')
    const scriptsDir = join(agentRoot, 'venv', 'Scripts')
    await mkdir(join(agentRoot, 'tools'), { recursive: true })
    await mkdir(join(agentRoot, 'diting_cli'), { recursive: true })
    await mkdir(scriptsDir, { recursive: true })
    await writeFile(join(agentRoot, 'tools', 'write_approval.py'), '', 'utf-8')
    await writeFile(join(agentRoot, 'diting_cli', 'write_approval_commands.py'), '', 'utf-8')

    const DiTingBin = join(scriptsDir, 'DiTing.exe')
    await writeFile(DiTingBin, '', 'utf-8')
    process.env.DiTing_BIN = DiTingBin
    delete process.env.DiTing_AGENT_ROOT

    const { isWriteGateSupported } = await loadService()

    expect(isWriteGateSupported()).toBe(true)
  })

  it('detects write approval support from a pip-installed runtime Python', async () => {
    const fakePython = join(DiTingHome, 'python')
    await writeFile(fakePython, [
      '#!/bin/sh',
      'case "$2" in',
      '  *"tools.write_approval"*"diting_cli.write_approval_commands"*) exit 0 ;;',
      '  *) exit 1 ;;',
      'esac',
      '',
    ].join('\n'), 'utf-8')
    await chmod(fakePython, 0o755)
    process.env.DiTing_AGENT_CLI_PYTHON = fakePython
    process.env.DiTing_BIN = join(DiTingHome, 'missing-DiTing')
    delete process.env.DiTing_AGENT_ROOT

    const { isWriteGateSupported } = await loadService()

    expect(isWriteGateSupported()).toBe(true)
  })
})
