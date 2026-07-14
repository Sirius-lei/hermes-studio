import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const execFileCalls = vi.hoisted(() => [] as Array<{ command: string; args: string[]; options: any }>)
const spawnCalls = vi.hoisted(() => [] as Array<{ command: string; args: string[]; options: any }>)

vi.mock('child_process', () => ({
  execFile: vi.fn((command: string, args: string[], options: any, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    execFileCalls.push({ command, args, options })
    callback(null, 'ok\n', '')
  }),
  spawn: vi.fn((command: string, args: string[], options: any) => {
    spawnCalls.push({ command, args, options })
    return {} as any
  }),
}))

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform })
}

afterEach(() => {
  execFileCalls.length = 0
  spawnCalls.length = 0
  delete process.env.DiTing_AGENT_BRIDGE_PYTHON
  delete process.env.DiTing_AGENT_CLI_PYTHON
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
  vi.resetModules()
})

describe('DiTing process invocation', () => {
  it('bypasses the uv DiTing.exe trampoline on Windows packaged installs', async () => {
    setPlatform('win32')
    process.env.DiTing_AGENT_CLI_PYTHON = 'C:\\Users\\me\\AppData\\Local\\Programs\\DiTing Studio\\resources\\python\\python.exe'
    const { execDiTingWithBin } = await import('../../packages/server/src/services/DiTing/DiTing-process')

    const result = await execDiTingWithBin(
      'C:\\Users\\me\\AppData\\Local\\Programs\\DiTing Studio\\resources\\python\\Scripts\\DiTing.exe',
      ['kanban', '--board', 'default', 'create', 'demo', '--json'],
      { windowsHide: true },
    )

    expect(result.stdout).toBe('ok\n')
    expect(execFileCalls[0]).toMatchObject({
      command: process.env.DiTing_AGENT_CLI_PYTHON,
      args: ['-m', 'DiTing_cli.main', 'kanban', '--board', 'default', 'create', 'demo', '--json'],
      options: expect.objectContaining({ windowsHide: true }),
    })
  })

  it('discovers sibling python.exe for a Windows DiTing.exe launcher', async () => {
    setPlatform('win32')
    const root = mkdtempSync(join(tmpdir(), 'DiTing-process-'))
    try {
      const scripts = join(root, 'Scripts')
      mkdirSync(scripts)
      writeFileSync(join(root, 'python.exe'), '')
      writeFileSync(join(scripts, 'DiTing.exe'), '')
      const { execDiTingWithBin } = await import('../../packages/server/src/services/DiTing/DiTing-process')

      await execDiTingWithBin(join(scripts, 'DiTing.exe'), ['--version'])

      expect(execFileCalls[0]).toMatchObject({
        command: join(root, 'python.exe'),
        args: ['-m', 'DiTing_cli.main', '--version'],
        options: expect.objectContaining({ windowsHide: true }),
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps normal DiTing command execution unchanged on non-Windows platforms', async () => {
    setPlatform('darwin')
    const { execDiTingWithBin } = await import('../../packages/server/src/services/DiTing/DiTing-process')

    await execDiTingWithBin('/opt/DiTing/bin/DiTing', ['--version'], { windowsHide: true })

    expect(execFileCalls[0]).toMatchObject({
      command: '/opt/DiTing/bin/DiTing',
      args: ['--version'],
    })
  })

  it('defaults spawned Windows DiTing processes to hidden windows', async () => {
    setPlatform('win32')
    process.env.DiTing_AGENT_CLI_PYTHON = 'C:\\DiTing Studio\\resources\\python\\python.exe'
    const { spawnDiTingWithBin } = await import('../../packages/server/src/services/DiTing/DiTing-process')

    spawnDiTingWithBin('C:\\DiTing Studio\\resources\\python\\Scripts\\DiTing.exe', ['gateway', 'run'])

    expect(spawnCalls[0]).toMatchObject({
      command: process.env.DiTing_AGENT_CLI_PYTHON,
      args: ['-m', 'DiTing_cli.main', 'gateway', 'run'],
      options: expect.objectContaining({ windowsHide: true }),
    })
  })
})
