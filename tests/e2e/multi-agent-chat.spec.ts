import { expect, test, type Page } from '@playwright/test'
import { authenticate, mockChatSocket, mockHermesApi, TEST_ACCESS_KEY } from './fixtures'

const inputPlaceholder = 'Type a message... (Enter to send, Shift+Enter for new line)'

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

test('shows animated collaboration state and preserves expandable workflow history across runs', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await mockHermesApi(page)
  await mockChatSocket(page)

  await page.addInitScript(() => {
    window.localStorage.removeItem('hermes.multiAgent.workflowArchives.v1')
    window.localStorage.setItem('hermes.subAgents.frontendDraft.v4', JSON.stringify([
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

  await page.goto('/#/hermes/chat')

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
        { id: 'understand', title: '理解需求与约束', phase: '分析', status: 'done', executor: { type: 'hermes', name: '主智能体' }, summary: '已提取目标与边界。' },
        { id: 'route', title: '生成任务清单', phase: '规划', status: 'done', executor: { type: 'hermes', name: '主智能体' }, summary: '已形成执行路径。' },
        { id: 'execute', title: '执行子任务：问数智能体', phase: '执行', status: 'doing', executor: { type: 'subagent', id: 'data-agent', name: '问数智能体' }, summary: '正在查询 8 月月报数据。' },
        { id: 'respond', title: '汇总阶段成果并回复用户', phase: '汇总', status: 'todo', executor: { type: 'hermes', name: '主智能体' }, summary: '等待结果汇总。' },
      ],
    },
  })

  await expect(multiAgentPanel).toContainText('任务清单')
  await expect(multiAgentPanel).toContainText('执行画布')
  await expect(multiAgentPanel).toContainText('规划任务中')
  await expect(multiAgentPanel).toContainText('当前状态')
  await expect(multiAgentPanel).toContainText('已匹配子智能体：问数智能体')
  await expect(multiAgentPanel).toContainText('子智能体：问数智能体')
  await expect(multiAgentPanel).not.toContainText('状态流')
  await expect(multiAgentPanel).not.toContainText('Hermes 编排')
  await expect(multiAgentPanel).not.toContainText('规划中')

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

  await expect(page.getByText('子智能体协作开始执行：查询海关月报 8 月详情')).toBeVisible()
  await expect(page.getByText('子智能体协作调用工具 query-bi：正在查询 8 月月报数据')).toBeVisible()
  await expect(page.getByText('子智能体协作已返回 8 月月报摘要。')).toBeVisible()

  const workflowCards = page.locator('.workflow-card')
  await expect(workflowCards).toHaveCount(1)
  await workflowCards.first().locator('.workflow-card-head').click()
  await expect(workflowCards.first()).toContainText('任务目标')
  await expect(workflowCards.first()).toContainText('查询海关月报 8 月详情')
  await expect(workflowCards.first()).toContainText('主智能体正在提炼任务目标、关键约束，并评估可用子智能体。')
  await expect(workflowCards.first()).toContainText('执行事件')
  await expect(workflowCards.first()).toContainText('已返回 8 月月报摘要。')

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
        { id: 'understand', title: '理解需求与约束', phase: '分析', status: 'done', executor: { type: 'hermes', name: '主智能体' }, summary: '已提取目标与边界。' },
        { id: 'route', title: '生成任务清单', phase: '规划', status: 'done', executor: { type: 'hermes', name: '主智能体' }, summary: '已形成执行路径。' },
        { id: 'execute', title: '执行子任务：问数智能体', phase: '执行', status: 'doing', executor: { type: 'subagent', id: 'data-agent', name: '问数智能体' }, summary: '正在查询 9 月月报数据。' },
        { id: 'respond', title: '汇总阶段成果并回复用户', phase: '汇总', status: 'todo', executor: { type: 'hermes', name: '主智能体' }, summary: '等待结果汇总。' },
      ],
    },
  })
  await emitSocketEvent(page, secondRun.session_id, {
    event: 'subagent.start',
    run_id: 'run-ma-2',
    subagent_id: 'data-agent',
    agent_name: '问数智能体',
    goal: '查询海关月报 9 月详情',
    task_index: 0,
    task_count: 1,
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

  await expect(workflowCards).toHaveCount(2)
  await workflowCards.nth(1).locator('.workflow-card-head').click()
  await expect(workflowCards.nth(1)).toContainText('查询海关月报 9 月详情')
  await expect(workflowCards.first()).toContainText('查询海关月报 8 月详情')
  await expect(multiAgentPanel).not.toContainText('Hermes 编排')
  await expect(multiAgentPanel).not.toContainText('规划中')
})
