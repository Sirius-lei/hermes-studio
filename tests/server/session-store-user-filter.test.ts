import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const all = vi.fn(() => [])
  const prepare = vi.fn(() => ({ all }))
  return {
    all,
    prepare,
    db: { prepare },
  }
})

vi.mock('../../packages/server/src/db/index', () => ({
  isSqliteAvailable: vi.fn(() => true),
  getDb: vi.fn(() => mocks.db),
}))

describe('session store user filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.all.mockReturnValue([])
  })

  it('applies user_id before limiting a session list', async () => {
    const { listSessions } = await import('../../packages/server/src/db/DiTing/session-store')

    listSessions('research', 'cli', 25, 7)

    expect(mocks.prepare).toHaveBeenCalledWith(expect.stringContaining('AND s.user_id = ?'))
    expect(mocks.all).toHaveBeenCalledWith('research', 'cli', '7', 25)
  })

  it('applies user_id to full-text-style session search', async () => {
    const { searchSessions } = await import('../../packages/server/src/db/DiTing/session-store')

    searchSessions('research', 'docker', 10, 7)

    expect(mocks.prepare).toHaveBeenCalledWith(expect.stringContaining('AND user_id = ?'))
    expect(mocks.all).toHaveBeenCalledWith(
      'research',
      '7',
      '%docker%',
      '%docker%',
      '%docker%',
      '%docker%',
      10,
    )
  })
})
