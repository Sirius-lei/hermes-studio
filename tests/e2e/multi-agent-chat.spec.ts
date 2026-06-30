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

test('renders real multi-agent route state only after route event and keeps failed subagent runs out of completed state', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await mockHermesApi(page)
  await mockChatSocket(page)

  await page.addInitScript(() => {
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

  await page.getByRole('button', { name: /开启多智能体协作模式|开启多智能体/ }).click()
  const multiAgentPanel = page.getByTestId('multi-agent-panel')
  await expect(multiAgentPanel.getByTestId('multi-agent-placeholder')).toBeVisible()
  await expect(multiAgentPanel.getByText('任务节点')).toHaveCount(0)

  await sendChatMessage(page, '查询海关月报 8 月详情')
  const run = await waitForRun(page)

  expect(run.multi_agent_mode).toBe(true)
  expect(Array.isArray(run.sub_agent_candidates)).toBe(true)
  expect(run.sub_agent_candidates[0]).toMatchObject({
    id: 'data-agent',
    name: '问数智能体',
  })

  await page.evaluate((sid) => {
    const socket = (window as any).__PW_CHAT_SOCKET__.latest
    socket.__trigger('run.started', { event: 'run.started', session_id: sid, run_id: 'run-ma-1' })
    socket.__trigger('agent.event', {
      event: 'agent.event',
      session_id: sid,
      kind: 'multi_agent_route',
      mode: 'delegate_subagent',
      category: '数据任务',
      reason: '命中数据分析能力',
      text: '多智能体协作：已路由到子智能体「问数智能体」。',
      selected_agent: { id: 'data-agent', name: '问数智能体' },
      plan: {
        objective: '查询海关月报 8 月详情',
        status: 'running',
        currentNodeId: 'execute',
        nodes: [
          { id: 'understand', title: '理解需求与约束', phase: '分析', status: 'done', executor: { type: 'hermes', name: 'Hermes' }, summary: '已提取目标。' },
          { id: 'route', title: '确认执行路径', phase: '路由', status: 'done', executor: { type: 'hermes', name: 'Hermes' }, summary: '已完成路由。' },
          { id: 'execute', title: '执行子任务：问数智能体', phase: '执行', status: 'doing', executor: { type: 'subagent', id: 'data-agent', name: '问数智能体' }, summary: '正在调用子智能体。' },
          { id: 'respond', title: '汇总阶段成果并回复用户', phase: '汇总', status: 'todo', executor: { type: 'hermes', name: 'Hermes' }, summary: '等待汇总。' },
        ],
      },
    })
    socket.__trigger('subagent.start', {
      event: 'subagent.start',
      session_id: sid,
      run_id: 'run-ma-1',
      subagent_id: 'data-agent',
      agent_name: '问数智能体',
      goal: '查询海关月报 8 月详情',
      task_index: 0,
      task_count: 1,
    })
    socket.__trigger('subagent.tool', {
      event: 'subagent.tool',
      session_id: sid,
      run_id: 'run-ma-1',
      subagent_id: 'data-agent',
      agent_name: '问数智能体',
      tool_name: 'query-bi',
      tool_count: 1,
      text: '正在查询 8 月月报数据',
      task_index: 0,
      task_count: 1,
    })
    socket.__trigger('subagent.complete', {
      event: 'subagent.complete',
      session_id: sid,
      run_id: 'run-ma-1',
      subagent_id: 'data-agent',
      agent_name: '问数智能体',
      status: 'failed',
      summary: '子智能体未返回可显示内容。',
      task_index: 0,
      task_count: 1,
    })
    socket.__trigger('run.failed', {
      event: 'run.failed',
      session_id: sid,
      run_id: 'run-ma-1',
      error: 'sub-agent 问数智能体 failed: empty output',
    })
  }, run.session_id)

  const executeTask = page.getByTestId('multi-agent-task-execute')
  await expect(executeTask).toContainText('执行子任务：问数智能体')
  await expect(executeTask).toContainText('失败')
  await expect(executeTask).not.toContainText('已完成')

  const currentNode = page.getByTestId('multi-agent-current-node')
  await expect(currentNode).toContainText('执行子任务：问数智能体')
  await expect(currentNode).toContainText('失败')

  const activity = page.getByTestId('multi-agent-activity')
  await expect(activity).toContainText('调用工具：query-bi')
  await expect(activity).toContainText('子智能体未返回可显示内容。')

  await expect(multiAgentPanel).toContainText('执行失败')
})
