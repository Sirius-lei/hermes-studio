import { EventEmitter } from 'events'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

class FakeChild extends EventEmitter {
  pid: number
  killSignals: string[] = []

  constructor(pid: number) {
    super()
    this.pid = pid
  }

  unref() { /* no-op */ }

  kill(signal?: string) {
    this.killSignals.push(signal || 'SIGTERM')
    return true
  }
}

let fakeChildren: FakeChild[] = []

vi.mock('../../packages/server/src/services/DiTing/DiTing-process', () => ({
  execDiTingWithBin: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  spawnDiTingWithBin: vi.fn(() => {
    const child = new FakeChild(20000 + fakeChildren.length)
    fakeChildren.push(child)
    return child
  }),
}))

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.resetModules()
  process.env = { ...originalEnv }
  fakeChildren = []
})

describe('profile delete managed gateway lifecycle', () => {
  it('reproduces #1633 and proves delete prep suppresses managed respawn', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const home = await mkdtemp(join(tmpdir(), 'wui-1633-'))
    process.env.DiTing_HOME = home
    process.env.DiTing_BIN = '/usr/bin/DiTing'
    const profileDir = join(home, 'profiles', 'work')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'config.yaml'), 'model:\n  default: test\n', 'utf-8')

    try {
      const { startGatewayRunManaged } = await import('../../packages/server/src/services/DiTing/gateway-runner')
      const { prepareGatewayForProfileDelete } = await import('../../packages/server/src/services/DiTing/gateway-autostart')

      startGatewayRunManaged('/usr/bin/DiTing', { profileDir })
      expect(fakeChildren).toHaveLength(1)

      const prep = prepareGatewayForProfileDelete('work')
      expect(fakeChildren[0].killSignals).toEqual(['SIGTERM'])

      fakeChildren[0].emit('exit', 0, 'SIGTERM')
      await prep
      await vi.advanceTimersByTimeAsync(6000)

      expect(fakeChildren).toHaveLength(1)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
