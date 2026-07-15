/**
 * Tests for the disabled DiTing session import path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('session-sync', () => {
  let db: any = null

  beforeEach(async () => {
    vi.resetModules()
    const { DatabaseSync } = await import('node:sqlite')
    db = new DatabaseSync(':memory:')
    vi.doMock('../../packages/server/src/db/index', () => ({
      getDb: () => db,
      getStoragePath: () => ':memory:',
    }))
    vi.doMock('../../packages/server/src/db/DiTing/sessions-db', () => ({
      listSessionSummaries: vi.fn().mockResolvedValue([]),
      getSessionDetailFromDbWithProfile: vi.fn(),
    }))
  })

  afterEach(() => {
    db?.close()
    db = null
    vi.doUnmock('../../packages/server/src/db/index')
    vi.doUnmock('../../packages/server/src/db/DiTing/sessions-db')
    vi.resetModules()
  })

  async function initTestDb() {
    const { initAllStores } = await import('../../packages/server/src/db/DiTing/init')
    initAllStores()
  }

  it('does not import DiTing sessions when local DB is not empty', async () => {
    await initTestDb()
    const { syncAllDiTingSessionsOnStartup } = await import('../../packages/server/src/services/DiTing/session-sync')

    db.prepare(`
      INSERT INTO sessions (id, profile, source, model, title, started_at, last_active)
      VALUES ('test-session-1', 'default', 'api_server', 'gpt-4', 'Test Session', ?, ?)
    `).run(Date.now(), Date.now())

    await syncAllDiTingSessionsOnStartup()

    const countAfter = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }
    expect(countAfter.count).toBe(1)
  })

  it('does not import DiTing sessions when local DB is empty', async () => {
    await initTestDb()
    const { syncAllDiTingSessionsOnStartup } = await import('../../packages/server/src/services/DiTing/session-sync')

    await expect(syncAllDiTingSessionsOnStartup()).resolves.toBeUndefined()

    const countAfter = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }
    expect(countAfter.count).toBe(0)
  })
})
