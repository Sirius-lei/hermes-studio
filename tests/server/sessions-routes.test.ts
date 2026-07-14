import { beforeEach, describe, expect, it, vi } from 'vitest'

const listConversationsMock = vi.fn(async (ctx: any) => { ctx.body = { sessions: [{ id: 'conversation-1' }] } })
const getConversationMessagesMock = vi.fn(async (ctx: any) => { ctx.body = { session_id: ctx.params.id, messages: [] } })
const getConversationMessagesPaginatedMock = vi.fn(async (ctx: any) => { ctx.body = { session_id: ctx.params.id, messages: [], pagination: {} } })
const listMock = vi.fn(async (ctx: any) => { ctx.body = { sessions: [{ id: 's1' }] } })
const countMock = vi.fn(async (ctx: any) => { ctx.body = { count: 1 } })
const listDiTingSessionsMock = vi.fn(async (ctx: any) => { ctx.body = { sessions: [{ id: 'DiTing-1' }] } })
const getDiTingSessionMock = vi.fn(async (ctx: any) => { ctx.body = { session: { id: ctx.params.id } } })
const importDiTingSessionMock = vi.fn(async (ctx: any) => { ctx.body = { session_id: ctx.params.id } })
const searchMock = vi.fn(async (ctx: any) => { ctx.body = { results: [{ id: 'search-1' }] } })
const getMock = vi.fn(async (ctx: any) => { ctx.body = { session: { id: ctx.params.id } } })
const getContextMock = vi.fn(async (ctx: any) => { ctx.body = { session_id: ctx.params.id, messages: [] } })
const removeMock = vi.fn(async (ctx: any) => { ctx.body = { ok: true } })
const renameMock = vi.fn(async (ctx: any) => { ctx.body = { ok: true } })
const setWorkspaceMock = vi.fn(async (ctx: any) => { ctx.body = { ok: true } })
const setModelMock = vi.fn(async (ctx: any) => { ctx.body = { ok: true } })
const listWorkspaceFoldersMock = vi.fn(async (ctx: any) => { ctx.body = { folders: [] } })
const createWorkspaceFolderMock = vi.fn(async (ctx: any) => { ctx.body = { ok: true } })
const renameWorkspaceFolderMock = vi.fn(async (ctx: any) => { ctx.body = { ok: true } })
const deleteWorkspaceFolderMock = vi.fn(async (ctx: any) => { ctx.body = { ok: true } })
const usageBatchMock = vi.fn(async (ctx: any) => { ctx.body = {} })
const usageSingleMock = vi.fn(async (ctx: any) => { ctx.body = { input_tokens: 0, output_tokens: 0 } })
const usageStatsMock = vi.fn(async (ctx: any) => { ctx.body = { total_input_tokens: 0, total_output_tokens: 0 } })
const contextLengthMock = vi.fn(async (ctx: any) => { ctx.body = { context_length: 256000 } })
const batchRemoveMock = vi.fn(async (ctx: any) => { ctx.body = { deleted: 1, failed: 0, errors: [] } })
const exportSessionMock = vi.fn(async (ctx: any) => { ctx.body = JSON.stringify({ id: ctx.params.id }) })

vi.mock('../../packages/server/src/controllers/DiTing/sessions', () => ({
  listConversations: listConversationsMock,
  getConversationMessages: getConversationMessagesMock,
  getConversationMessagesPaginated: getConversationMessagesPaginatedMock,
  list: listMock,
  count: countMock,
  listDiTingSessions: listDiTingSessionsMock,
  getDiTingSession: getDiTingSessionMock,
  importDiTingSession: importDiTingSessionMock,
  search: searchMock,
  get: getMock,
  getContext: getContextMock,
  remove: removeMock,
  batchRemove: batchRemoveMock,
  rename: renameMock,
  setWorkspace: setWorkspaceMock,
  setModel: setModelMock,
  listWorkspaceFolders: listWorkspaceFoldersMock,
  createWorkspaceFolder: createWorkspaceFolderMock,
  renameWorkspaceFolder: renameWorkspaceFolderMock,
  deleteWorkspaceFolder: deleteWorkspaceFolderMock,
  usageBatch: usageBatchMock,
  usageSingle: usageSingleMock,
  usageStats: usageStatsMock,
  contextLength: contextLengthMock,
  exportSession: exportSessionMock,
}))

describe('session routes', () => {
  beforeEach(() => {
    vi.resetModules()
    listConversationsMock.mockClear()
    getConversationMessagesMock.mockClear()
    getConversationMessagesPaginatedMock.mockClear()
    listMock.mockClear()
    countMock.mockClear()
    listDiTingSessionsMock.mockClear()
    getDiTingSessionMock.mockClear()
    importDiTingSessionMock.mockClear()
    searchMock.mockClear()
    getMock.mockClear()
    getContextMock.mockClear()
    removeMock.mockClear()
    renameMock.mockClear()
    setModelMock.mockClear()
    listWorkspaceFoldersMock.mockClear()
    createWorkspaceFolderMock.mockClear()
    renameWorkspaceFolderMock.mockClear()
    deleteWorkspaceFolderMock.mockClear()
  })

  it('registers conversations, session list, and search routes', async () => {
    const { sessionRoutes } = await import('../../packages/server/src/routes/DiTing/sessions')
    const paths = sessionRoutes.stack.map((entry: any) => entry.path)

    expect(paths).toEqual(expect.arrayContaining([
      '/api/DiTing/sessions/conversations',
      '/api/DiTing/sessions/conversations/:id/messages',
      '/api/DiTing/sessions/conversations/:id/messages/paginated',
      '/api/DiTing/sessions',
      '/api/DiTing/sessions/count',
      '/api/DiTing/sessions/DiTing',
      '/api/DiTing/sessions/DiTing/:id',
      '/api/DiTing/sessions/DiTing/:id/import',
      '/api/DiTing/search/sessions',
      '/api/DiTing/sessions/search',
      '/api/DiTing/sessions/usage',
      '/api/DiTing/usage/stats',
      '/api/DiTing/sessions/context-length',
      '/api/DiTing/sessions/:id/context',
      '/api/DiTing/sessions/:id',
      '/api/DiTing/sessions/:id/export',
      '/api/DiTing/sessions/:id/usage',
      '/api/DiTing/sessions/:id/rename',
      '/api/DiTing/sessions/:id/model',
      '/api/DiTing/workspace/folders',
      '/api/DiTing/workspace/folders/rename',
    ]))
  })

  it('delegates session count route before the session id route', async () => {
    const { sessionRoutes } = await import('../../packages/server/src/routes/DiTing/sessions')
    const countLayer = sessionRoutes.stack.find((entry: any) => entry.path === '/api/DiTing/sessions/count')
    const idLayer = sessionRoutes.stack.find((entry: any) => entry.path === '/api/DiTing/sessions/:id')
    expect(sessionRoutes.stack.indexOf(countLayer)).toBeLessThan(sessionRoutes.stack.indexOf(idLayer))

    const ctx: any = { query: { source: 'cli' }, body: null, params: {} }
    await countLayer.stack[0](ctx)

    expect(countMock).toHaveBeenCalledWith(ctx)
    expect(getMock).not.toHaveBeenCalled()
    expect(ctx.body).toEqual({ count: 1 })
  })

  it('delegates session context route to the controller', async () => {
    const { sessionRoutes } = await import('../../packages/server/src/routes/DiTing/sessions')
    const layer = sessionRoutes.stack.find((entry: any) => entry.path === '/api/DiTing/sessions/:id/context')
    const handler = layer.stack[0]
    const ctx: any = { query: {}, body: null, params: { id: 'session-1' } }

    await handler(ctx)

    expect(getContextMock).toHaveBeenCalledWith(ctx)
    expect(ctx.body).toEqual({ session_id: 'session-1', messages: [] })
  })

  it('delegates workspace folder routes to the controller', async () => {
    const { sessionRoutes } = await import('../../packages/server/src/routes/DiTing/sessions')
    const listLayer = sessionRoutes.stack.find((entry: any) => entry.path === '/api/DiTing/workspace/folders' && entry.methods.includes('HEAD'))
    const createLayer = sessionRoutes.stack.find((entry: any) => entry.path === '/api/DiTing/workspace/folders' && entry.methods.includes('POST'))
    const renameLayer = sessionRoutes.stack.find((entry: any) => entry.path === '/api/DiTing/workspace/folders/rename')
    const deleteLayer = sessionRoutes.stack.find((entry: any) => entry.path === '/api/DiTing/workspace/folders' && entry.methods.includes('DELETE'))

    const listCtx: any = { query: {}, request: { body: {} }, body: null, params: {} }
    await listLayer.stack[0](listCtx)
    expect(listWorkspaceFoldersMock).toHaveBeenCalledWith(listCtx)

    const createCtx: any = { query: {}, request: { body: { parentPath: '', name: 'new-folder' } }, body: null, params: {} }
    await createLayer.stack[0](createCtx)
    expect(createWorkspaceFolderMock).toHaveBeenCalledWith(createCtx)

    const renameCtx: any = { query: {}, request: { body: { path: 'old-folder', name: 'new-folder' } }, body: null, params: {} }
    await renameLayer.stack[0](renameCtx)
    expect(renameWorkspaceFolderMock).toHaveBeenCalledWith(renameCtx)

    const deleteCtx: any = { query: {}, request: { body: { path: 'new-folder' } }, body: null, params: {} }
    await deleteLayer.stack[0](deleteCtx)
    expect(deleteWorkspaceFolderMock).toHaveBeenCalledWith(deleteCtx)
  })

  it('delegates session search to the controller', async () => {
    const { sessionRoutes } = await import('../../packages/server/src/routes/DiTing/sessions')
    const layer = sessionRoutes.stack.find((entry: any) => entry.path === '/api/DiTing/search/sessions')
    const handler = layer.stack[0]
    const ctx: any = { query: { q: 'docker', limit: '8' }, body: null, params: {} }

    await handler(ctx)

    expect(searchMock).toHaveBeenCalledWith(ctx)
    expect(ctx.body).toEqual({ results: [{ id: 'search-1' }] })
  })

  it('keeps the legacy search path wired to the same controller', async () => {
    const { sessionRoutes } = await import('../../packages/server/src/routes/DiTing/sessions')
    const layer = sessionRoutes.stack.find((entry: any) => entry.path === '/api/DiTing/sessions/search')
    const handler = layer.stack[0]
    const ctx: any = { query: { q: 'docker' }, body: null, params: {} }

    await handler(ctx)

    expect(searchMock).toHaveBeenCalledWith(ctx)
    expect(ctx.body).toEqual({ results: [{ id: 'search-1' }] })
  })

  it('delegates conversations list and detail routes', async () => {
    const { sessionRoutes } = await import('../../packages/server/src/routes/DiTing/sessions')
    const listLayer = sessionRoutes.stack.find((entry: any) => entry.path === '/api/DiTing/sessions/conversations')
    const detailLayer = sessionRoutes.stack.find((entry: any) => entry.path === '/api/DiTing/sessions/conversations/:id/messages')

    const listCtx: any = { query: {}, body: null, params: {} }
    await listLayer.stack[0](listCtx)
    expect(listConversationsMock).toHaveBeenCalledWith(listCtx)
    expect(listCtx.body).toEqual({ sessions: [{ id: 'conversation-1' }] })

    const detailCtx: any = { params: { id: 'child-session' }, query: {}, body: null }
    await detailLayer.stack[0](detailCtx)
    expect(getConversationMessagesMock).toHaveBeenCalledWith(detailCtx)
    expect(detailCtx.body).toEqual({ session_id: 'child-session', messages: [] })
  })

  it('delegates DiTing session import to the controller', async () => {
    const { sessionRoutes } = await import('../../packages/server/src/routes/DiTing/sessions')
    const layer = sessionRoutes.stack.find((entry: any) => entry.path === '/api/DiTing/sessions/DiTing/:id/import')
    const handler = layer.stack[0]
    const ctx: any = { params: { id: 'DiTing-abc' }, query: {}, request: { body: { profile: 'default' } }, body: null }

    await handler(ctx)

    expect(importDiTingSessionMock).toHaveBeenCalledWith(ctx)
    expect(ctx.body).toEqual({ session_id: 'DiTing-abc' })
  })

  it('delegates session export to the controller', async () => {
    const { sessionRoutes } = await import('../../packages/server/src/routes/DiTing/sessions')
    const layer = sessionRoutes.stack.find((entry: any) => entry.path === '/api/DiTing/sessions/:id/export')
    const handler = layer.stack[0]
    const ctx: any = { params: { id: 'session-abc' }, query: {}, body: null, set: vi.fn() }

    await handler(ctx)

    expect(exportSessionMock).toHaveBeenCalledWith(ctx)
  })
})
