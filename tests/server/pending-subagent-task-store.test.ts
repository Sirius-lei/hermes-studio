import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('pending subagent task store', () => {
  let db: any = null

  beforeEach(async () => {
    vi.resetModules()
    const { DatabaseSync } = await import('node:sqlite')
    db = new DatabaseSync(':memory:')
    vi.doMock('../../packages/server/src/db/index', () => ({
      getDb: () => db,
      getStoragePath: () => ':memory:',
      jsonDelete: vi.fn(),
      jsonGet: vi.fn(),
      jsonGetAll: vi.fn(() => ({})),
      jsonSet: vi.fn(),
    }))
  })

  afterEach(() => {
    db?.close()
    db = null
    vi.doUnmock('../../packages/server/src/db/index')
    vi.resetModules()
  })

  it('persists and restores clarify_required tasks with mixed clarification field styles', async () => {
    const { initAllDiTingTables } = await import('../../packages/server/src/db/DiTing/schemas')
    const {
      deletePendingSubagentTask,
      getPendingSubagentTask,
      listPendingSubagentTasks,
      upsertPendingSubagentTask,
    } = await import('../../packages/server/src/db/DiTing/pending-subagent-task-store')

    initAllDiTingTables()

    const record = upsertPendingSubagentTask({
      session_id: 'sess-1',
      task_id: 'task-1',
      collaboration_run_id: 'run-1',
      profile: 'default',
      node_id: 'node-clarify',
      agent_id: 'agent-qs',
      agent_name: '问数智能体',
      objective: '查询张三涉案信息',
      question: '请补充身份证号或手机号后四位。',
      required_fields: ['身份证号', '手机号后四位'],
      clarification: {
        question: '请补充身份证号或手机号后四位。',
        reason: '姓名重名，无法继续检索。',
        acceptableAnyOf: true,
      },
      route_decision_json: {
        mode: 'delegate_subagent',
        delegatedNodeIds: ['node-clarify'],
      },
      result_json: {
        status: 'clarify_required',
      },
      last_result_summary: '等待补充',
      last_visible_output: '请补充身份证号或手机号后四位。',
    })

    expect(record.clarification.acceptable_any_of).toBe(true)
    expect(record.clarification.required_fields).toEqual(['身份证号', '手机号后四位'])

    const restored = getPendingSubagentTask('sess-1')
    expect(restored).not.toBeNull()
    expect(restored?.agent_name).toBe('问数智能体')
    expect(restored?.clarification.reason).toBe('姓名重名，无法继续检索。')
    expect(restored?.clarification.acceptable_any_of).toBe(true)

    const listed = listPendingSubagentTasks('default')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.session_id).toBe('sess-1')

    deletePendingSubagentTask('sess-1')
    expect(getPendingSubagentTask('sess-1')).toBeNull()
  })
})
