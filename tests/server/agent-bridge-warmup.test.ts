import { afterEach, describe, expect, it, vi } from 'vitest'

describe('agent bridge warmup', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  it('does not warm profiles when env is unset', async () => {
    const mod = await import('../../packages/server/src/services/DiTing/agent-bridge/warmup')
    expect(mod.resolveWarmProfiles(undefined, 'research')).toEqual([])
  })

  it('supports the active alias and deduplicates values', async () => {
    const mod = await import('../../packages/server/src/services/DiTing/agent-bridge/warmup')
    expect(mod.resolveWarmProfiles('active,default,active,research', 'ops')).toEqual(['ops', 'default', 'research'])
  })

  it('allows disabling bridge warmup explicitly', async () => {
    const mod = await import('../../packages/server/src/services/DiTing/agent-bridge/warmup')
    expect(mod.resolveWarmProfiles('off', 'default')).toEqual([])
    expect(mod.resolveWarmProfiles('0', 'default')).toEqual([])
  })
})
