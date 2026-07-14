import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = {
  listBoards: vi.fn(async (ctx: any) => { ctx.body = { boards: [] } }),
  createBoard: vi.fn(async (ctx: any) => { ctx.body = { board: {} } }),
  archiveBoard: vi.fn(async (ctx: any) => { ctx.body = { ok: true } }),
  capabilities: vi.fn(async (ctx: any) => { ctx.body = { capabilities: {} } }),
  stats: vi.fn(async (ctx: any) => { ctx.body = { stats: {} } }),
  assignees: vi.fn(async (ctx: any) => { ctx.body = { assignees: [] } }),
  readArtifact: vi.fn(async (ctx: any) => { ctx.body = { content: 'x' } }),
  searchSessions: vi.fn(async (ctx: any) => { ctx.body = { results: [] } }),
  linkTasks: vi.fn(async (ctx: any) => { ctx.body = { ok: true } }),
  unlinkTasks: vi.fn(async (ctx: any) => { ctx.body = { ok: true } }),
  bulkUpdateTasks: vi.fn(async (ctx: any) => { ctx.body = { results: [] } }),
  list: vi.fn(async (ctx: any) => { ctx.body = { tasks: [] } }),
  get: vi.fn(async (ctx: any) => { ctx.body = { task: {} } }),
  create: vi.fn(async (ctx: any) => { ctx.body = { task: {} } }),
  complete: vi.fn(async (ctx: any) => { ctx.body = { ok: true } }),
  unblock: vi.fn(async (ctx: any) => { ctx.body = { ok: true } }),
  block: vi.fn(async (ctx: any) => { ctx.body = { ok: true } }),
  assign: vi.fn(async (ctx: any) => { ctx.body = { ok: true } }),
  addComment: vi.fn(async (ctx: any) => { ctx.body = { ok: true } }),
  taskLog: vi.fn(async (ctx: any) => { ctx.body = { log: '' } }),
  diagnostics: vi.fn(async (ctx: any) => { ctx.body = { diagnostics: [] } }),
  reclaim: vi.fn(async (ctx: any) => { ctx.body = { ok: true } }),
  reassign: vi.fn(async (ctx: any) => { ctx.body = { ok: true } }),
  specify: vi.fn(async (ctx: any) => { ctx.body = { results: [] } }),
  dispatch: vi.fn(async (ctx: any) => { ctx.body = { result: {} } }),
}

vi.mock('../../packages/server/src/controllers/DiTing/kanban', () => handlers)

describe('kanban routes', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.values(handlers).forEach(fn => fn.mockClear())
  })

  it('registers all kanban routes', async () => {
    const { kanbanRoutes } = await import('../../packages/server/src/routes/DiTing/kanban')
    const paths = kanbanRoutes.stack.map((entry: any) => entry.path)

    expect(paths).toEqual(expect.arrayContaining([
      '/api/DiTing/kanban/boards',
      '/api/DiTing/kanban/boards/:slug',
      '/api/DiTing/kanban/capabilities',
      '/api/DiTing/kanban/stats',
      '/api/DiTing/kanban/assignees',
      '/api/DiTing/kanban/diagnostics',
      '/api/DiTing/kanban/dispatch',
      '/api/DiTing/kanban/artifact',
      '/api/DiTing/kanban/search-sessions',
      '/api/DiTing/kanban/links',
      '/api/DiTing/kanban/tasks/bulk',
      '/api/DiTing/kanban',
      '/api/DiTing/kanban/:id',
      '/api/DiTing/kanban/complete',
      '/api/DiTing/kanban/unblock',
      '/api/DiTing/kanban/:id/block',
      '/api/DiTing/kanban/:id/assign',
      '/api/DiTing/kanban/:id/comments',
      '/api/DiTing/kanban/:id/log',
      '/api/DiTing/kanban/:id/reclaim',
      '/api/DiTing/kanban/:id/reassign',
      '/api/DiTing/kanban/:id/specify',
    ]))
  })

  it('delegates search-sessions to the controller', async () => {
    const { kanbanRoutes } = await import('../../packages/server/src/routes/DiTing/kanban')
    const layer = kanbanRoutes.stack.find((entry: any) => entry.path === '/api/DiTing/kanban/search-sessions')
    const ctx: any = { query: { task_id: 'task-1', profile: 'alice' }, body: null, params: {} }

    await layer.stack[0](ctx)

    expect(handlers.searchSessions).toHaveBeenCalledWith(ctx)
    expect(ctx.body).toEqual({ results: [] })
  })
})
