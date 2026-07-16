import { afterEach, describe, expect, it, vi } from 'vitest'

const originalHome = process.env.DiTing_WEB_UI_HOME

afterEach(() => {
  if (originalHome === undefined) delete process.env.DiTing_WEB_UI_HOME
  else process.env.DiTing_WEB_UI_HOME = originalHome
  vi.resetModules()
})

describe('user storage paths', () => {
  it('isolates session workspaces and files by authenticated user', async () => {
    process.env.DiTing_WEB_UI_HOME = '/tmp/diting-user-storage-test'
    vi.resetModules()
    const storage = await import('../../packages/server/src/services/DiTing/user-storage')

    const userOneWorkspace = storage.getUserSessionWorkspaceDir(1, 'session-a')
    const userTwoWorkspace = storage.getUserSessionWorkspaceDir(2, 'session-a')
    const userOneFiles = storage.getUserFilesDir(1, 'research')

    expect(userOneWorkspace.replace(/\\/g, '/')).toBe('/tmp/diting-user-storage-test/users/1/sessions/session-a/workspace')
    expect(userTwoWorkspace.replace(/\\/g, '/')).toBe('/tmp/diting-user-storage-test/users/2/sessions/session-a/workspace')
    expect(userOneFiles.replace(/\\/g, '/')).toBe('/tmp/diting-user-storage-test/users/1/files/research')
    expect(userOneWorkspace).not.toBe(userTwoWorkspace)
    expect(storage.isPathInUserStorage(userOneWorkspace, 1)).toBe(true)
    expect(storage.isPathInUserStorage(userOneWorkspace, 2)).toBe(false)
    expect(storage.resolveUserFilesPath(1, 'research', 'reports/result.txt').replace(/\\/g, '/'))
      .toBe('/tmp/diting-user-storage-test/users/1/files/research/reports/result.txt')
  })

  it('rejects path traversal in user and session identifiers', async () => {
    process.env.DiTing_WEB_UI_HOME = '/tmp/diting-user-storage-test'
    vi.resetModules()
    const storage = await import('../../packages/server/src/services/DiTing/user-storage')

    expect(() => storage.getUserStorageRoot('../other-user')).toThrow('Invalid user_id')
    expect(() => storage.getUserSessionDir(1, '../other-session')).toThrow('Invalid session_id')
    expect(() => storage.resolveUserFilesPath(1, 'default', '../other-user/secret.txt')).toThrow('Invalid file path')
  })
})
