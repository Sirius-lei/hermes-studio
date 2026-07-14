import { expect, test, type Page } from '@playwright/test'
import { authenticate, mockChatSocket, mockDiTingApi, TEST_ACCESS_KEY } from './fixtures'

const inputPlaceholder = 'Type a message... (Enter to send, Shift+Enter for new line)'
const archiveStorageKey = 'DiTing.multiAgent.workflowArchives.v1'

async function sendChatMessage(page: Page, message: string) {
  const input = page.getByPlaceholder(inputPlaceholder)
  await expect(input).toBeVisible()
  await input.fill(message)
  await page.getByRole('button', { name: 'Send' }).click()
}

async function waitForRun(page: Page, index = 0) {
  const handle = await page.waitForFunction((runIndex) => {
    const state = (window as any).__PW_CHAT_SOCKET__
    const runs = state?.emitted?.filter((item: any) => item.event === 'run') || []
    const run = runs[runIndex]
    return run ? run.payload : null
  }, index)
  return handle.jsonValue() as Promise<any>
}

async function emitSocketEvent(page: Page, sessionId: string, event: Record<string, unknown>) {
  await page.evaluate(({ sid, payload }) => {
    const socket = (window as any).__PW_CHAT_SOCKET__.latest
    socket.__trigger(String(payload.event || ''), { ...payload, session_id: sid })
  }, { sid: sessionId, payload: event })
}

test('renders the right-side multi-agent workflow panel with expandable execution details', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await mockDiTingApi(page)
  await mockChatSocket(page)

  await page.addInitScript(() => {
    window.localStorage.removeItem('DiTing.multiAgent.workflowArchives.v1')
    window.localStorage.setItem('DiTing.subAgents.frontendDraft.v4', JSON.stringify([
      {
        id: 'data-agent',
        name: '问数智能体',
        description: '负责数据查询与报表分析',
        baseUrl: 'https://example.invalid',
        status: 'active',
        runtimeConfig: {
          enabled: true,
          chatPath: '/v1/chat/completions',
        },
        skills: [
          { name: 'sql', description: 'SQL 查询' },
        ],
        tools: [
          { name: 'query-bi', description: '查询 BI 数据' },
        ],
      },
    ]))
  })

  await page.goto('/#/DiTing/chat')

  await page.getByRole('button', { name: /开启多智能体协作模式|开启多智能体|多智能体/ }).click()
  const multiAgentPanel = page.getByTestId('multi-agent-panel')
  await expect(multiAgentPanel.getByTestId('multi-agent-placeholder')).toBeVisible()

  await sendChatMessage(page, '查询海关月报 8 月详情')
  const firstRun = await waitForRun(page, 0)

  expect(firstRun.multi_agent_mode).toBe(true)
  expect(Array.isArray(firstRun.sub_agent_candidates)).toBe(true)
  expect(firstRun.sub_agent_candidates[0]).toMatchObject({
    id: 'data-agent',
    name: '问数智能体',
  })

  await emitSocketEvent(page, firstRun.session_id, {
    event: 'run.started',
    run_id: 'run-ma-1',
  })
  await emitSocketEvent(page, firstRun.session_id, {
    event: 'agent.event',
    kind: 'multi_agent_reasoning',
    stage: 'understand',
    text: '主智能体正在提炼任务目标、',
  })
  await emitSocketEvent(page, firstRun.session_id, {
    event: 'agent.event',
    kind: 'multi_agent_reasoning',
    stage: 'understand',
    text: '关键约束，并评估可用子智能体。',
  })
  await emitSocketEvent(page, firstRun.session_id, {
    event: 'agent.event',
    kind: 'multi_agent_route',
    mode: 'delegate_subagent',
    category: '数据任务',
    reason: '命中数据分析能力，已进入协作执行。',
    text: '多智能体协作：已路由到子智能体「问数智能体」。',
    selected_agent: { id: 'data-agent', name: '问数智能体' },
    plan: {
      objective: '查询海关月报 8 月详情',
      status: 'running',
      currentNodeId: 'execute',
      nodes: [
        { id: 'understand', title: '理解需求与约束', phase: '分析', status: 'done', executor: { type: 'DiTing', name: '主智能体' }, summary: '已提取目标与边界。' },
        { id: 'route', title: '生成任务清单', phase: '规划', status: 'done', executor: { type: 'DiTing', name: '主智能体' }, summary: '已形成执行路径。' },
        { id: 'execute', title: '执行子任务：问数智能体', phase: '执行', status: 'doing', executor: { type: 'subagent', id: 'data-agent', name: '问数智能体' }, summary: '正在查询 8 月月报数据。' },
        { id: 'respond', title: '汇总阶段成果并回复用户', phase: '汇总', status: 'todo', executor: { type: 'DiTing', name: '主智能体' }, summary: '等待结果汇总。' },
      ],
    },
  })

  await expect(multiAgentPanel).toContainText('任务目标')
  await expect(multiAgentPanel).toContainText('标准执行计划')
  await expect(multiAgentPanel).toContainText('意图识别')
  await expect(multiAgentPanel).toContainText('任务拆解')
  await expect(multiAgentPanel).toContainText('执行清单 (Todo List)')
  await expect(multiAgentPanel).toContainText('执行节点画布')
  await expect(multiAgentPanel).toContainText('问数智能体')
  await expect(multiAgentPanel).not.toContainText('DiTing 编排')
  await expect(multiAgentPanel).not.toContainText('状态流')
  const workflowCard = page.locator('.workflow-card')
  await expect(workflowCard).toHaveCount(1)
  await expect(workflowCard).toContainText('执行过程')
  await expect(workflowCard).not.toContainText('理解需求与约束')

  await workflowCard.locator('.workflow-card-head').click()
  await expect(workflowCard).toContainText('理解需求')
  await expect(workflowCard).toContainText('规划路径')
  await expect(workflowCard).toContainText('已提取任务目标')

  const canvas = multiAgentPanel.locator('.multi-agent-canvas')
  await expect(canvas).toBeVisible()
  await multiAgentPanel.getByTestId('multi-agent-canvas-toggle').click()
  await expect(canvas).toBeHidden()
  await multiAgentPanel.getByTestId('multi-agent-canvas-toggle').click()
  await expect(canvas).toBeVisible()

  await emitSocketEvent(page, firstRun.session_id, {
    event: 'subagent.start',
    run_id: 'run-ma-1',
    subagent_id: 'data-agent',
    agent_name: '问数智能体',
    goal: '查询海关月报 8 月详情',
    task_index: 0,
    task_count: 1,
  })
  await emitSocketEvent(page, firstRun.session_id, {
    event: 'subagent.tool',
    run_id: 'run-ma-1',
    subagent_id: 'data-agent',
    agent_name: '问数智能体',
    tool_name: 'query-bi',
    text: '正在查询 8 月月报数据',
    task_index: 0,
    task_count: 1,
  })
  await emitSocketEvent(page, firstRun.session_id, {
    event: 'subagent.complete',
    run_id: 'run-ma-1',
    subagent_id: 'data-agent',
    agent_name: '问数智能体',
    status: 'completed',
    summary: '已返回 8 月月报摘要。',
    task_index: 0,
    task_count: 1,
  })
  await emitSocketEvent(page, firstRun.session_id, {
    event: 'run.completed',
    run_id: 'run-ma-1',
    output: '首轮协作已完成，已返回 8 月月报摘要。',
  })

  await expect(workflowCard).toContainText('query-bi')
  await expect(workflowCard).toContainText('已返回 8 月月报摘要。')
  await expect(multiAgentPanel).toContainText('已完成')

  await sendChatMessage(page, '查询海关月报 9 月详情')
  const secondRun = await waitForRun(page, 1)

  await emitSocketEvent(page, secondRun.session_id, {
    event: 'run.started',
    run_id: 'run-ma-2',
  })
  await emitSocketEvent(page, secondRun.session_id, {
    event: 'agent.event',
    kind: 'multi_agent_route',
    mode: 'delegate_subagent',
    category: '数据任务',
    reason: '命中数据分析能力，继续走协作执行。',
    text: '多智能体协作：再次路由到子智能体「问数智能体」。',
    selected_agent: { id: 'data-agent', name: '问数智能体' },
    plan: {
      objective: '查询海关月报 9 月详情',
      status: 'running',
      currentNodeId: 'execute',
      nodes: [
        { id: 'understand', title: '理解需求与约束', phase: '分析', status: 'done', executor: { type: 'DiTing', name: '主智能体' }, summary: '已提取目标与边界。' },
        { id: 'route', title: '生成任务清单', phase: '规划', status: 'done', executor: { type: 'DiTing', name: '主智能体' }, summary: '已形成执行路径。' },
        { id: 'execute', title: '执行子任务：问数智能体', phase: '执行', status: 'doing', executor: { type: 'subagent', id: 'data-agent', name: '问数智能体' }, summary: '正在查询 9 月月报数据。' },
        { id: 'respond', title: '汇总阶段成果并回复用户', phase: '汇总', status: 'todo', executor: { type: 'DiTing', name: '主智能体' }, summary: '等待结果汇总。' },
      ],
    },
  })
  await emitSocketEvent(page, secondRun.session_id, {
    event: 'subagent.complete',
    run_id: 'run-ma-2',
    subagent_id: 'data-agent',
    agent_name: '问数智能体',
    status: 'completed',
    summary: '已返回 9 月月报摘要。',
    task_index: 0,
    task_count: 1,
  })
  await emitSocketEvent(page, secondRun.session_id, {
    event: 'run.completed',
    run_id: 'run-ma-2',
    output: '第二轮协作已完成，已返回 9 月月报摘要。',
  })

  await expect(multiAgentPanel).toContainText('查询海关月报 9 月详情')
  const archiveCount = await page.evaluate((storageKey) => {
    try {
      const value = window.localStorage.getItem(storageKey)
      return Array.isArray(JSON.parse(value || '[]')) ? JSON.parse(value || '[]').length : 0
    } catch {
      return 0
    }
  }, archiveStorageKey)
  expect(archiveCount).toBeGreaterThanOrEqual(2)
})

test('builds real todo and canvas nodes from route.todo when planner nodes are missing', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await mockDiTingApi(page)
  await mockChatSocket(page)

  await page.addInitScript(() => {
    window.localStorage.setItem('DiTing.subAgents.frontendDraft.v4', JSON.stringify([
      {
        id: 'data-agent',
        name: '问数智能体',
        description: '负责数据查询与报表分析',
        baseUrl: 'https://example.invalid',
        status: 'active',
        runtimeConfig: {
          enabled: true,
          chatPath: '/v1/chat/completions',
        },
      },
    ]))
  })

  await page.goto('/#/DiTing/chat')
  await page.getByRole('button', { name: /开启多智能体协作模式|开启多智能体|多智能体/ }).click()

  await sendChatMessage(page, '查询海关月报 8 月详情')
  const run = await waitForRun(page, 0)

  await emitSocketEvent(page, run.session_id, {
    event: 'run.started',
    run_id: 'run-ma-fallback',
  })
  await emitSocketEvent(page, run.session_id, {
    event: 'agent.event',
    kind: 'multi_agent_route',
    mode: 'delegate_subagent',
    category: '数据任务',
    reason: 'Planner 暂未返回结构化执行节点，先使用真实待办清单继续执行。',
    text: '多智能体协作：已匹配问数智能体，等待生成详细执行节点。',
    todo: [
      '确认月报口径与时间范围',
      '调用问数智能体检索 8 月月报数据',
      '汇总阶段结果并回复用户',
    ],
    constraints: [
      '默认“8 月”按自然月处理。',
      '需要问数智能体返回可核验的数据来源。',
      '输出时保留缺失字段说明。',
    ],
    selected_agent: { id: 'data-agent', name: '问数智能体' },
    plan: {
      objective: '查询海关月报 8 月详情',
      status: 'running',
      currentNodeId: 'route',
      nodes: [
        { id: 'understand', title: '理解需求与约束', phase: '分析', status: 'done', executor: { type: 'DiTing', name: '主智能体' }, summary: '已提取目标与边界。' },
        { id: 'route', title: '确认执行路径', phase: '规划', status: 'doing', executor: { type: 'DiTing', name: '主智能体' }, summary: '等待补齐执行节点。' },
        { id: 'respond', title: '汇总阶段成果并回复用户', phase: '汇总', status: 'todo', executor: { type: 'DiTing', name: '主智能体' }, summary: '等待结果汇总。' },
      ],
    },
  })

  const multiAgentPanel = page.getByTestId('multi-agent-panel')
  await expect(multiAgentPanel).toContainText('确认月报口径与时间范围')
  await expect(multiAgentPanel).toContainText('调用问数智能体检索 8 月月报数据')
  await expect(multiAgentPanel).toContainText('汇总阶段成果并回复用户')
  await expect(multiAgentPanel.locator('.multi-agent-canvas')).toContainText('调用问数智能体检索 8 月月报数据')

  await emitSocketEvent(page, run.session_id, {
    event: 'subagent.start',
    run_id: 'run-ma-fallback',
    subagent_id: 'data-agent',
    agent_name: '问数智能体',
    goal: '调用问数智能体检索 8 月月报数据',
    task_index: 0,
    task_count: 1,
  })
  await emitSocketEvent(page, run.session_id, {
    event: 'subagent.complete',
    run_id: 'run-ma-fallback',
    subagent_id: 'data-agent',
    agent_name: '问数智能体',
    status: 'completed',
    summary: '已返回 8 月月报核心数据。',
    task_index: 0,
    task_count: 1,
  })

  await expect(multiAgentPanel).toContainText('2 / 3 完成')
  await expect(multiAgentPanel).toContainText('问数智能体')
})

test('keeps downstream nodes blocked from success after delegated node failure', async ({ page }, testInfo) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await mockDiTingApi(page)
  await mockChatSocket(page)

  await page.addInitScript(() => {
    window.localStorage.removeItem('DiTing.multiAgent.workflowArchives.v1')
    window.localStorage.setItem('DiTing.subAgents.frontendDraft.v4', JSON.stringify([
      {
        id: 'data-agent',
        name: '问数智能体',
        description: '负责涉案数据检索',
        baseUrl: 'https://example.invalid',
        status: 'active',
        runtimeConfig: {
          enabled: true,
          chatPath: '/v1/chat/completions',
        },
      },
    ]))
  })

  await page.goto('/#/DiTing/chat')
  await page.getByRole('button', { name: /开启多智能体协作模式|开启多智能体|多智能体/ }).click()

  await sendChatMessage(page, '继续核验张三涉案信息')
  const run = await waitForRun(page, 0)

  await emitSocketEvent(page, run.session_id, {
    event: 'run.started',
    run_id: 'run-ma-failure-gate',
  })
  await emitSocketEvent(page, run.session_id, {
    event: 'agent.event',
    kind: 'multi_agent_route',
    mode: 'delegate_subagent',
    category: '数据任务',
    reason: '命中问数智能体能力，进入协作执行。',
    text: '多智能体协作：已匹配问数智能体，准备检索涉案记录。',
    selected_agent: { id: 'data-agent', name: '问数智能体' },
    plan: {
      objective: '继续核验张三涉案信息',
      status: 'running',
      currentNodeId: 'task_1',
      nodes: [
        { id: 'understand', title: '理解需求与约束', phase: '分析', status: 'done', executor: { type: 'DiTing', name: '主智能体' }, summary: '已提取查询目标。' },
        { id: 'route', title: '确认执行路径', phase: '路由', status: 'done', executor: { type: 'DiTing', name: '主智能体' }, summary: '已确认委派问数智能体。' },
        { id: 'task_1', title: '检索涉案记录', phase: '执行', status: 'doing', executor: { type: 'subagent', id: 'data-agent', name: '问数智能体' }, summary: '正在检索涉案记录。' },
        { id: 'task_2', title: '身份归并与去重', phase: '执行', status: 'todo', executor: { type: 'DiTing', name: '主智能体' }, summary: '等待检索结果。' },
        { id: 'task_3', title: '汇总结果并回复用户', phase: '汇总', status: 'todo', executor: { type: 'DiTing', name: '主智能体' }, summary: '等待身份归并完成。' },
        { id: 'respond', title: '汇总阶段成果并回复用户', phase: '汇总', status: 'todo', executor: { type: 'DiTing', name: '主智能体' }, summary: '等待最终回复。' },
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

  const multiAgentPanel = page.getByTestId('multi-agent-panel')
  await expect(multiAgentPanel).toContainText('检索涉案记录')
  await expect(multiAgentPanel).toContainText('身份归并与去重')

  await emitSocketEvent(page, run.session_id, {
    event: 'subagent.complete',
    run_id: 'run-ma-failure-gate',
    collaboration_run_id: 'collab-failure-gate-1',
    subagent_id: 'data-agent',
    agent_name: '问数智能体',
    plan_node_ids: ['task_1'],
    blocked_plan_node_ids: ['task_2', 'task_3', 'respond'],
    status: 'failed',
    node_status: 'failed',
    summary: 'fetch failed for http://172.16.50.149:8768/v1/chat/completions',
  })

  await expect(multiAgentPanel).toContainText('等待重规划')
  await expect(multiAgentPanel).not.toContainText('4 / 4 完成')
  await expect(multiAgentPanel.locator('.multi-agent-todo-item.is-error')).toContainText('检索涉案记录')
  await expect(multiAgentPanel.locator('.multi-agent-todo-item.is-warning').first()).toContainText('身份归并与去重')

  await emitSocketEvent(page, run.session_id, {
    event: 'assistant.message',
    run_id: 'run-ma-failure-gate',
    message_id: 'assistant-failure-gate-1',
    content: '问数智能体在“检索涉案记录”节点执行失败，原因是子智能体接口不可达。由于后续“身份归并与去重”“汇总结果并回复用户”依赖该检索结果，我已暂停这些节点，等待重新规划。',
  })
  await emitSocketEvent(page, run.session_id, {
    event: 'run.failed',
    run_id: 'run-ma-failure-gate',
    assistant_feedback_sent: true,
    error: 'sub-agent 问数智能体 failed: fetch failed for http://172.16.50.149:8768/v1/chat/completions',
  })

  await expect(multiAgentPanel).toContainText('执行失败')
  await expect(multiAgentPanel).toContainText('已跳过')
  await expect(page.getByText('我已暂停这些节点，等待重新规划。')).toBeVisible()

  await page.screenshot({
    path: testInfo.outputPath('multi-agent-failure-gating.png'),
    fullPage: true,
  })
})
