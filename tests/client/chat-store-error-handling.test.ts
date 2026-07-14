// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const chatApi = vi.hoisted(() => ({
  startRunViaSocket: vi.fn(),
  resumeSession: vi.fn(),
  registerSessionHandlers: vi.fn(),
  unregisterSessionHandlers: vi.fn(),
}))

vi.mock('@/api/DiTing/chat', () => ({
  startRunViaSocket: chatApi.startRunViaSocket,
  resumeSession: chatApi.resumeSession,
  registerSessionHandlers: chatApi.registerSessionHandlers,
  unregisterSessionHandlers: chatApi.unregisterSessionHandlers,
  getChatRunSocket: vi.fn(() => ({ emit: vi.fn() })),
  respondToolApproval: vi.fn(),
  respondClarify: vi.fn(),
  onPeerUserMessage: vi.fn(() => vi.fn()),
  onSessionCommand: vi.fn(() => vi.fn()),
  onSessionTitleUpdated: vi.fn(() => vi.fn()),
}))

vi.mock('@/api/client', () => ({
  getActiveProfileName: () => 'default',
  hasApiKey: () => false,
}))

vi.mock('@/api/DiTing/sessions', () => ({
  deleteSession: vi.fn(),
  fetchSession: vi.fn(),
  fetchSessions: vi.fn(),
  setSessionModel: vi.fn(),
}))

vi.mock('@/api/DiTing/download', () => ({
  getDownloadUrl: (_path: string, name: string) => `/download/${name}`,
}))

vi.mock('@/api/DiTing/system', () => ({
  checkHealth: vi.fn(),
  fetchAvailableModels: vi.fn(),
  addCustomModel: vi.fn(),
  removeCustomModel: vi.fn(),
  updateDefaultModel: vi.fn(),
  updateModelVisibility: vi.fn(),
  updateModelAlias: vi.fn(),
}))

vi.mock('@/utils/completion-sound', () => ({
  primeCompletionSound: vi.fn(),
  playCompletionSound: vi.fn(),
}))

import { useChatStore, type Message, type Session } from '@/stores/DiTing/chat'

function makeSession(id: string): Session {
  return {
    id,
    title: id,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe('chat store error handling - #1644', () => {
  let handlers: any

  beforeEach(() => {
    handlers = undefined
    vi.resetAllMocks()
    setActivePinia(createPinia())
    chatApi.startRunViaSocket.mockReturnValue({ abort: vi.fn() })
    chatApi.resumeSession.mockImplementation((sessionId: string, onResumed: (data: any) => void) => {
      onResumed({
        session_id: sessionId,
        messages: [],
        isWorking: false,
        events: [],
      })
      return {} as any
    })
    chatApi.registerSessionHandlers.mockImplementation((_sessionId: string, registeredHandlers: any) => {
      handlers = registeredHandlers
      return vi.fn()
    })
  })

  it('preserves assistant content when run.failed fires during streaming with substantial content', async () => {
    const store = useChatStore()
    const session = makeSession('session-1')
    store.sessions = [session]
    store.activeSessionId = 'session-1'
    store.activeSession = session

    await store.sendMessage('run claude')

    const onEvent = chatApi.startRunViaSocket.mock.calls[0][1] as (event: any) => void

    // Simulate run.started
    onEvent({ event: 'run.started', session_id: 'session-1', run_id: 'run-1' })

    // Simulate message.delta with substantial content (>100 chars)
    const longContent = 'A'.repeat(200)
    onEvent({
      event: 'message.delta',
      session_id: 'session-1',
      run_id: 'run-1',
      delta: longContent,
      output: longContent,
    })

    // At this point the assistant message should be streaming with content
    let assistantMsg = store.activeSession?.messages.find(
      (m: Message) => m.role === 'assistant',
    )
    expect(assistantMsg).toBeDefined()
    expect(assistantMsg?.isStreaming).toBe(true)
    expect((assistantMsg as any)?.content).toBe(longContent)

    // Simulate run.failed (e.g., socket disconnect)
    onEvent({
      event: 'run.failed',
      session_id: 'session-1',
      run_id: 'run-1',
      error: 'Socket disconnected',
    })

    // The original assistant message should be preserved (not overwritten)
    const msgs = store.activeSession?.messages || []
    assistantMsg = msgs.find((m: Message) => m.content === longContent)
    expect(assistantMsg).toBeDefined()
    expect(assistantMsg?.content).toBe(longContent)
    expect(assistantMsg?.isStreaming).toBe(false)
    expect(assistantMsg?.systemType).toBeUndefined()

    // A separate error message should be appended
    const errorMessage = msgs.find(
      (m: Message) => m.role === 'assistant' && m.systemType === 'error',
    )
    expect(errorMessage).toBeDefined()
    expect(errorMessage?.content).toBe('Error: Socket disconnected')
  })

  it('overwrites empty streaming message when run.failed fires (no substantial content)', async () => {
    const store = useChatStore()
    const session = makeSession('session-1')
    store.sessions = [session]
    store.activeSessionId = 'session-1'
    store.activeSession = session

    await store.sendMessage('run claude')

    const onEvent = chatApi.startRunViaSocket.mock.calls[0][1] as (event: any) => void

    // Simulate run.started
    onEvent({ event: 'run.started', session_id: 'session-1', run_id: 'run-1' })

    // Simulate message.delta with only a short content (<100 chars)
    onEvent({
      event: 'message.delta',
      session_id: 'session-1',
      run_id: 'run-1',
      delta: 'Hi',
      output: 'Hi',
    })

    // Simulate run.failed
    onEvent({
      event: 'run.failed',
      session_id: 'session-1',
      run_id: 'run-1',
      error: 'Something went wrong',
    })

    const msgs = store.activeSession?.messages || []
    const assistantMsg = msgs.find((m: Message) => m.role === 'assistant')
    expect(assistantMsg).toBeDefined()
    expect(assistantMsg?.content).toBe('Error: Something went wrong')
    expect(assistantMsg?.systemType).toBe('error')
    expect(assistantMsg?.isStreaming).toBe(false)
  })

  it('appends error as separate message when streaming has finished (isStreaming false)', async () => {
    const store = useChatStore()
    const session = makeSession('session-1')
    store.sessions = [session]
    store.activeSessionId = 'session-1'
    store.activeSession = session

    await store.sendMessage('run claude')

    const onEvent = chatApi.startRunViaSocket.mock.calls[0][1] as (event: any) => void

    // Simulate run.started
    onEvent({ event: 'run.started', session_id: 'session-1', run_id: 'run-1' })

    // Simulate message.delta
    onEvent({
      event: 'message.delta',
      session_id: 'session-1',
      run_id: 'run-1',
      delta: 'Hello, how can I help you?',
      output: 'Hello, how can I help you?',
    })

    // Simulate run.completed (closes streaming)
    onEvent({
      event: 'run.completed',
      session_id: 'session-1',
      run_id: 'run-1',
    })

    // At this point isStreaming should be false
    const assistantMsg = store.activeSession?.messages.find(
      (m: Message) => m.role === 'assistant',
    )
    expect(assistantMsg?.isStreaming).toBe(false)

    // Now simulate run.failed (e.g., late socket error)
    onEvent({
      event: 'run.failed',
      session_id: 'session-1',
      run_id: 'run-1',
      error: 'Late socket error',
    })

    // Original message should be unchanged
    const msgs = store.activeSession?.messages || []
    const firstAssistant = msgs.find((m: Message) => m.content === 'Hello, how can I help you?')
    expect(firstAssistant).toBeDefined()
    expect(firstAssistant?.systemType).toBeUndefined()

    // Error appended as separate message
    const errorMessage = msgs.find((m: Message) => m.systemType === 'error')
    expect(errorMessage).toBeDefined()
    expect(errorMessage?.content).toBe('Error: Late socket error')
  })

  it('renders delegated failure feedback as an assistant message and skips duplicate terminal error text', async () => {
    const store = useChatStore()
    const session = makeSession('session-1')
    store.sessions = [session]
    store.activeSessionId = 'session-1'
    store.activeSession = session

    await store.sendMessage('query data')

    const onEvent = chatApi.startRunViaSocket.mock.calls[0][1] as (event: any) => void

    onEvent({
      event: 'assistant.message',
      session_id: 'session-1',
      run_id: 'run-failure-feedback',
      message_id: 'assistant-feedback-1',
      content: '问数智能体在“查询涉案信息”节点执行失败，原因是数据库暂不可用。我正在重新规划后续处理路径。',
    })

    onEvent({
      event: 'run.failed',
      session_id: 'session-1',
      run_id: 'run-failure-feedback',
      assistant_feedback_sent: true,
      error: 'sub-agent 问数智能体 failed: 数据库暂不可用',
    })

    const assistantMessages = store.activeSession?.messages.filter((message: Message) => message.role === 'assistant') ?? []
    expect(assistantMessages).toEqual([
      expect.objectContaining({
        id: 'assistant-feedback-1',
        content: '问数智能体在“查询涉案信息”节点执行失败，原因是数据库暂不可用。我正在重新规划后续处理路径。',
      }),
    ])
    expect(store.activeSession?.messages.some((message: Message) => message.systemType === 'error')).toBe(false)
  })

  it('keeps multi-agent route running and marks node unsafe when delegated result is not finalizable', async () => {
    const store = useChatStore()
    const session = makeSession('session-1')
    store.sessions = [session]
    store.activeSessionId = 'session-1'
    store.activeSession = session

    await store.sendMessage('query data')

    const onEvent = chatApi.startRunViaSocket.mock.calls[0][1] as (event: any) => void

    onEvent({ event: 'run.started', session_id: 'session-1', run_id: 'run-unsafe' })
    onEvent({
      event: 'agent.event',
      session_id: 'session-1',
      collaboration_run_id: 'collab-unsafe-1',
      kind: 'multi_agent_route',
      mode: 'delegate_subagent',
      intent: 'query_case',
      category: '数据任务',
      reason: '委派给问数智能体',
      text: '委派给问数智能体',
      todo: ['查询涉案记录', '汇总结果'],
      constraints: [],
      selected_agent: {
        id: 'data-agent',
        name: '问数智能体',
      },
      plan: {
        currentNodeId: 'task_1',
        nodes: [
          { id: 'understand', title: '理解需求', phase: '分析', status: 'done', executor: { type: 'DiTing', name: '主智能体' }, summary: 'done' },
          { id: 'route', title: '确认路径', phase: '路由', status: 'done', executor: { type: 'DiTing', name: '主智能体' }, summary: 'done' },
          { id: 'task_1', title: '查询涉案记录', phase: '执行', status: 'doing', executor: { type: 'subagent', id: 'data-agent', name: '问数智能体' }, summary: '执行中' },
          { id: 'task_2', title: '汇总涉案记录', phase: '汇总', status: 'todo', executor: { type: 'DiTing', name: '主智能体' }, summary: '等待 task_1' },
          { id: 'respond', title: '汇总回复', phase: '汇总', status: 'todo', executor: { type: 'DiTing', name: '主智能体' }, summary: '等待汇总' },
        ],
        dependencies: [
          { from: 'understand', to: 'route', type: 'blocks' },
          { from: 'route', to: 'task_1', type: 'blocks' },
          { from: 'task_1', to: 'task_2', type: 'blocks' },
          { from: 'task_2', to: 'respond', type: 'blocks' },
        ],
      },
    })

    onEvent({
      event: 'subagent.complete',
      session_id: 'session-1',
      collaboration_run_id: 'collab-unsafe-1',
      run_id: 'run-unsafe',
      subagent_id: 'data-agent',
      agent_name: '问数智能体',
      plan_node_ids: ['task_1'],
      status: 'partial',
      node_status: 'partial',
      node_completed: false,
      grounding_status: 'unsafe_to_finalize',
      output_completeness: 'truncated',
      finalizable: false,
      summary: '只返回部分摘要，不能直接汇总',
      output: '只返回部分摘要，不能直接汇总',
      blocked_plan_node_ids: ['task_2', 'respond'],
    })

    const route = store.multiAgentRoutes.get('session-1')
    const node = route?.planNodes.find(item => item.id === 'task_1')
    const blockedTodoNode = route?.planNodes.find(item => item.id === 'task_2')
    const respondNode = route?.planNodes.find(item => item.id === 'respond')
    expect(route?.status).toBe('running')
    expect(node?.status).toBe('unsafe')
    expect(node?.outcome).toBe('unsafe')
    expect(blockedTodoNode?.status).toBe('waiting_replan')
    expect(blockedTodoNode?.outcome).toBe('failure')
    expect(respondNode?.status).toBe('waiting_replan')
  })

  it('does not advance downstream nodes to success after a delegated node hard-fails', async () => {
    const store = useChatStore()
    const session = makeSession('session-1')
    store.sessions = [session]
    store.activeSessionId = 'session-1'
    store.activeSession = session

    await store.sendMessage('query data')

    const onEvent = chatApi.startRunViaSocket.mock.calls[0][1] as (event: any) => void

    onEvent({ event: 'run.started', session_id: 'session-1', run_id: 'run-failed-node' })
    onEvent({
      event: 'agent.event',
      session_id: 'session-1',
      collaboration_run_id: 'collab-failed-node-1',
      kind: 'multi_agent_route',
      mode: 'delegate_subagent',
      intent: 'query_case',
      category: '数据任务',
      reason: '委派给问数智能体',
      text: '委派给问数智能体',
      todo: ['检索涉案记录', '身份归并', '汇总结果'],
      constraints: [],
      selected_agent: {
        id: 'data-agent',
        name: '问数智能体',
      },
      plan: {
        currentNodeId: 'task_1',
        nodes: [
          { id: 'understand', title: '理解需求', phase: '分析', status: 'done', executor: { type: 'DiTing', name: '主智能体' }, summary: 'done' },
          { id: 'route', title: '确认路径', phase: '路由', status: 'done', executor: { type: 'DiTing', name: '主智能体' }, summary: 'done' },
          { id: 'task_1', title: '检索涉案记录', phase: '执行', status: 'doing', executor: { type: 'subagent', id: 'data-agent', name: '问数智能体' }, summary: '执行中' },
          { id: 'task_2', title: '身份归并', phase: '执行', status: 'todo', executor: { type: 'DiTing', name: '主智能体' }, summary: '等待 task_1' },
          { id: 'task_3', title: '汇总结果', phase: '汇总', status: 'todo', executor: { type: 'DiTing', name: '主智能体' }, summary: '等待 task_2' },
          { id: 'respond', title: '汇总回复', phase: '汇总', status: 'todo', executor: { type: 'DiTing', name: '主智能体' }, summary: '等待汇总' },
        ],
        dependencies: [
          { from: 'understand', to: 'route', type: 'blocks' },
          { from: 'route', to: 'task_1', type: 'blocks' },
          { from: 'task_1', to: 'task_2', type: 'blocks' },
          { from: 'task_2', to: 'task_3', type: 'blocks' },
          { from: 'task_3', to: 'respond', type: 'blocks' },
        ],
      },
    })

    onEvent({
      event: 'subagent.complete',
      session_id: 'session-1',
      collaboration_run_id: 'collab-failed-node-1',
      run_id: 'run-failed-node',
      subagent_id: 'data-agent',
      agent_name: '问数智能体',
      plan_node_ids: ['task_1'],
      status: 'failed',
      node_status: 'failed',
      summary: 'fetch failed for http://subagent.test/v1/chat/completions',
      blocked_plan_node_ids: ['task_2', 'task_3', 'respond'],
    })

    const route = store.multiAgentRoutes.get('session-1')
    expect(route?.status).toBe('running')
    expect(route?.planNodes.find(item => item.id === 'task_1')?.status).toBe('failed')
    expect(route?.planNodes.find(item => item.id === 'task_2')?.status).toBe('waiting_replan')
    expect(route?.planNodes.find(item => item.id === 'task_3')?.status).toBe('waiting_replan')
    expect(route?.planNodes.find(item => item.id === 'respond')?.status).toBe('waiting_replan')
  })
})
