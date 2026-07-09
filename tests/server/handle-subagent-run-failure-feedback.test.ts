import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSessionMock = vi.hoisted(() => vi.fn())
const createSessionMock = vi.hoisted(() => vi.fn())
const addMessageMock = vi.hoisted(() => vi.fn())
const updateSessionStatsMock = vi.hoisted(() => vi.fn())
const updateUsageMock = vi.hoisted(() => vi.fn())
const calcAndUpdateUsageMock = vi.hoisted(() => vi.fn())
const pushStateMock = vi.hoisted(() => vi.fn((sessionMap: Map<string, any>, sessionId: string, event: string, data: any) => {
  if (!sessionMap.has(sessionId)) {
    sessionMap.set(sessionId, { messages: [], events: [], isWorking: false, queue: [] })
  }
  const state = sessionMap.get(sessionId)
  state.events.push({ event, data })
}))
const getOrCreateSessionMock = vi.hoisted(() => vi.fn((sessionMap: Map<string, any>, sessionId: string) => {
  if (!sessionMap.has(sessionId)) {
    sessionMap.set(sessionId, { messages: [], events: [], isWorking: false, queue: [] })
  }
  return sessionMap.get(sessionId)
}))
const pendingUpsertMock = vi.hoisted(() => vi.fn())
const pendingDeleteMock = vi.hoisted(() => vi.fn())

vi.mock('../../packages/server/src/db/hermes/session-store', () => ({
  getSession: getSessionMock,
  createSession: createSessionMock,
  addMessage: addMessageMock,
  updateSessionStats: updateSessionStatsMock,
}))

vi.mock('../../packages/server/src/db/hermes/usage-store', () => ({
  updateUsage: updateUsageMock,
}))

vi.mock('../../packages/server/src/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../packages/server/src/services/hermes/run-chat/compression', () => ({
  getOrCreateSession: getOrCreateSessionMock,
  pushState: pushStateMock,
}))

vi.mock('../../packages/server/src/services/hermes/run-chat/usage', () => ({
  calcAndUpdateUsage: calcAndUpdateUsageMock,
}))

vi.mock('../../packages/server/src/db/hermes/pending-subagent-task-store', () => ({
  upsertPendingSubagentTask: pendingUpsertMock,
  deletePendingSubagentTask: pendingDeleteMock,
}))

function makeSseResponse(content: string) {
  const payload = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`
  return new Response(payload, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function makeToolAndContentSseResponse(args: {
  piEvent: Record<string, unknown>
  content: string
}) {
  const payload = [
    `data: ${JSON.stringify({ choices: [{ delta: { pi_mono_event: args.piEvent } }] })}`,
    '',
    `data: ${JSON.stringify({ choices: [{ delta: { content: args.content } }] })}`,
    '',
    'data: [DONE]',
    '',
  ].join('\n')
  return new Response(payload, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function makeNamespace() {
  const emit = vi.fn()
  return {
    emit,
    nsp: {
      adapter: { rooms: new Map([['session:session-1', new Set(['socket-1'])]]) },
      to: vi.fn(() => ({ emit })),
    } as any,
  }
}

function makeSocket() {
  return {
    connected: true,
    emit: vi.fn(),
    join: vi.fn(),
    data: {},
  } as any
}

function makeDecision() {
  return {
    enabled: true,
    shouldPlan: true,
    summary: '查询涉案信息',
    intent: 'query_case',
    category: '涉案查询',
    confidence: 0.92,
    reason: '委派给问数智能体执行',
    executionMode: 'delegate_subagent',
    selectedAgent: {
      id: 'data-agent',
      name: '问数智能体',
      description: '查询案件数据库',
      baseUrl: 'http://subagent.test',
      chatPath: '/v1/chat/completions',
      enabled: true,
      skills: [],
      tools: [],
    },
    routeText: '委派问数智能体执行查询节点',
    hermesInstructions: '请在失败后重新规划。',
    inputText: '查询张三的涉案信息',
    conversationContext: '',
    todo: ['查询涉案信息'],
    constraints: [],
    plan: {
      objective: '查询张三涉案信息',
      status: 'running',
      currentNodeId: 'query_case',
      nodes: [
        {
          id: 'query_case',
          title: '查询涉案信息',
          phase: '执行',
          status: 'doing',
          executor: { type: 'subagent', id: 'data-agent', name: '问数智能体' },
          summary: '检索案件数据源',
        },
        {
          id: 'summarize_result',
          title: '汇总涉案结果',
          phase: '汇总',
          status: 'todo',
          executor: { type: 'hermes', name: '主智能体' },
          summary: '等待查询节点完成后汇总结果',
        },
        {
          id: 'respond',
          title: '回复用户',
          phase: '汇总',
          status: 'todo',
          executor: { type: 'hermes', name: '主智能体' },
          summary: '等待汇总完成后回复',
        },
      ],
      dependencies: [
        { from: 'query_case', to: 'summarize_result', type: 'blocks' },
        { from: 'summarize_result', to: 'respond', type: 'blocks' },
      ],
    },
    delegatedNodeIds: ['query_case'],
  } as any
}

describe('handleSubagentRun delegated failure feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockReturnValue({ id: 'session-1', profile: 'default' })
    addMessageMock.mockImplementation(({ role }: { role: string }) => role === 'assistant' ? 2001 : 1001)
    calcAndUpdateUsageMock.mockResolvedValue({ inputTokens: 10, outputTokens: 6 })
    pendingUpsertMock.mockImplementation((input: any) => ({
      ...input,
      collaboration_run_id: input.collaboration_run_id || null,
      profile: input.profile || 'default',
      status: 'clarify_required',
      created_at: Date.now(),
      updated_at: Date.now(),
    }))
    vi.stubGlobal('fetch', vi.fn())
  })

  it('emits assistant feedback and keeps the run alive when a failed delegated node is recoverable', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(makeSseResponse(JSON.stringify({
      status: 'failed',
      completed: false,
      summary: '数据库暂不可用',
      visible_output: '当前查询节点执行失败，数据库暂不可用。',
      blockers: ['数据库暂不可用'],
      evidence: [],
      artifacts: [],
    })))

    const { handleSubagentRun } = await import('../../packages/server/src/services/hermes/run-chat/handle-subagent-run')
    const { nsp, emit } = makeNamespace()
    const socket = makeSocket()
    const sessionMap = new Map<string, any>([['session-1', { messages: [], events: [], queue: [], isWorking: false }]])
    const continueWithHermes = vi.fn().mockResolvedValue(undefined)

    await handleSubagentRun(
      nsp,
      socket,
      {
        session_id: 'session-1',
        input: '查询张三的涉案信息',
      },
      'default',
      sessionMap as any,
      makeDecision(),
      undefined,
      true,
      { continueWithHermes },
    )

    expect(continueWithHermes).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('assistant.message', expect.objectContaining({
      content: expect.stringContaining('问数智能体在“查询涉案信息”节点执行失败'),
    }))
    expect(emit).toHaveBeenCalledWith('assistant.message', expect.objectContaining({
      content: expect.stringContaining('已暂停'),
    }))
    expect(emit.mock.calls.some(([event]: [string]) => event === 'run.failed')).toBe(false)
    expect(addMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      role: 'assistant',
      content: expect.stringContaining('我正在重新规划后续处理路径'),
    }))
    expect(String(continueWithHermes.mock.calls[0]?.[0]?.input || '')).not.toContain('当前查询节点执行失败，数据库暂不可用。')
  })

  it('blocks finalization and continues recovery when delegated output is partial / not finalizable', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(makeSseResponse(JSON.stringify({
      status: 'completed',
      completed: true,
      grounding_status: 'verified',
      output_completeness: 'truncated',
      finalizable: false,
      summary: '仅返回部分涉案摘要',
      visible_output: '当前返回内容存在截断，仅能确认部分涉案摘要。',
      structured_output: {},
      blockers: [],
      evidence: ['对话里只拿到了截断片段'],
      artifacts: [],
    })))

    const { handleSubagentRun } = await import('../../packages/server/src/services/hermes/run-chat/handle-subagent-run')
    const { nsp, emit } = makeNamespace()
    const socket = makeSocket()
    const sessionMap = new Map<string, any>([['session-1', { messages: [], events: [], queue: [], isWorking: false }]])
    const continueWithHermes = vi.fn().mockResolvedValue(undefined)

    await handleSubagentRun(
      nsp,
      socket,
      {
        session_id: 'session-1',
        input: '查询张三的涉案信息',
      },
      'default',
      sessionMap as any,
      makeDecision(),
      undefined,
      true,
      { continueWithHermes },
    )

    expect(continueWithHermes).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('subagent.result_received', expect.objectContaining({
      grounding_status: expect.stringMatching(/unsafe_to_finalize|truncated|unverified/),
      finalizable: false,
    }))
    expect(emit).toHaveBeenCalledWith('subagent.result_rejected', expect.objectContaining({
      finalizable: false,
    }))
    expect(emit).toHaveBeenCalledWith('subagent.finalization_blocked', expect.objectContaining({
      reason: expect.stringContaining('截断'),
    }))
    expect(emit.mock.calls.some(([event]: [string]) => event === 'run.failed')).toBe(false)
    expect(addMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      role: 'assistant',
      content: expect.stringContaining('不足以形成最终结论'),
    }))
    expect(String(continueWithHermes.mock.calls[0]?.[0]?.input || '')).not.toContain('当前返回内容存在截断，仅能确认部分涉案摘要。')
  })

  it('emits assistant feedback before terminal failure when a failed delegated node is not recoverable', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(makeSseResponse(JSON.stringify({
      status: 'failed',
      completed: false,
      summary: '数据库暂不可用',
      visible_output: '当前查询节点执行失败，数据库暂不可用。',
      blockers: ['数据库暂不可用'],
      evidence: [],
      artifacts: [],
    })))

    const { handleSubagentRun } = await import('../../packages/server/src/services/hermes/run-chat/handle-subagent-run')
    const { nsp, emit } = makeNamespace()
    const socket = makeSocket()
    const sessionMap = new Map<string, any>([['session-1', { messages: [], events: [], queue: [], isWorking: false }]])

    await handleSubagentRun(
      nsp,
      socket,
      {
        session_id: 'session-1',
        input: '查询张三的涉案信息',
      },
      'default',
      sessionMap as any,
      makeDecision(),
      undefined,
      true,
      {},
    )

    const assistantIndex = emit.mock.calls.findIndex(([event]: [string]) => event === 'assistant.message')
    const failedIndex = emit.mock.calls.findIndex(([event]: [string]) => event === 'run.failed')
    expect(assistantIndex).toBeGreaterThanOrEqual(0)
    expect(failedIndex).toBeGreaterThan(assistantIndex)
    expect(emit.mock.calls[failedIndex]?.[1]).toEqual(expect.objectContaining({
      assistant_feedback_sent: true,
    }))
    expect(addMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      role: 'assistant',
      content: expect.stringContaining('当前无法继续本轮任务'),
    }))
  })

  it('keeps clarify_required non-terminal behavior intact', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(makeSseResponse(JSON.stringify({
      status: 'clarify_required',
      completed: false,
      summary: '需要补充身份标识',
      visible_output: '请补充身份证号或手机号后四位。',
      blockers: ['缺少身份标识'],
      evidence: [],
      clarification: {
        question: '请补充身份证号或手机号后四位。',
        reason: '姓名重名，无法继续检索。',
        required_fields: ['身份证号', '手机号后四位'],
        acceptable_any_of: true,
      },
      artifacts: [],
    })))

    const { handleSubagentRun } = await import('../../packages/server/src/services/hermes/run-chat/handle-subagent-run')
    const { nsp, emit } = makeNamespace()
    const socket = makeSocket()
    const sessionMap = new Map<string, any>([['session-1', { messages: [], events: [], queue: [], isWorking: false }]])

    await handleSubagentRun(
      nsp,
      socket,
      {
        session_id: 'session-1',
        input: '查询张三的涉案信息',
      },
      'default',
      sessionMap as any,
      makeDecision(),
      undefined,
      true,
      {},
    )

    expect(emit).toHaveBeenCalledWith('subagent.clarify_required', expect.objectContaining({
      question: '请补充身份证号或手机号后四位。',
    }))
    expect(emit).toHaveBeenCalledWith('run.completed', expect.objectContaining({
      waiting_for_input: true,
      status: 'clarify_required',
    }))
    expect(emit.mock.calls.some(([event]: [string]) => event === 'run.failed')).toBe(false)
  })

  it('merges runtime published artifacts into the persisted assistant message and normalizes relative download urls', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(makeToolAndContentSseResponse({
      piEvent: {
        kind: 'tool_execution_end',
        name: 'publish_runtime_artifact',
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              artifact: {
                artifact_id: 'art_1',
                filename: 'cases.csv',
                download_url: '/api/files/download/art_1',
              },
            }),
          }],
        },
      },
      content: JSON.stringify({
        status: 'completed',
        completed: true,
        grounding_status: 'verified',
        output_completeness: 'full',
        finalizable: true,
        summary: '已生成结构化案件清单',
        visible_output: '已生成结构化案件清单。',
        structured_output: {
          rows: [{ case_no: '(2026)沪01民初1号' }],
          total: 1,
        },
        blockers: [],
        evidence: ['已输出结构化案件清单'],
      }),
    }))

    const { handleSubagentRun } = await import('../../packages/server/src/services/hermes/run-chat/handle-subagent-run')
    const { nsp, emit } = makeNamespace()
    const socket = makeSocket()
    const sessionMap = new Map<string, any>([['session-1', { messages: [], events: [], queue: [], isWorking: false }]])

    await handleSubagentRun(
      nsp,
      socket,
      {
        session_id: 'session-1',
        input: '查询张三的涉案信息',
      },
      'default',
      sessionMap as any,
      makeDecision(),
      undefined,
      true,
      {},
    )

    const assistantCall = addMessageMock.mock.calls.find(([input]: [Record<string, unknown>]) => input.role === 'assistant')
    expect(assistantCall).toBeTruthy()
    expect(String(assistantCall?.[0]?.content || '')).toContain('http://subagent.test/api/files/download/art_1')
    expect(emit).toHaveBeenCalledWith('subagent.artifact_published', expect.objectContaining({
      artifacts: expect.arrayContaining([
        expect.objectContaining({
          filename: 'cases.csv',
          downloadUrl: '/api/files/download/art_1',
        }),
      ]),
    }))
  })
})
