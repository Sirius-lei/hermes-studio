import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveMultiAgentRoute, type MultiAgentRouteCandidate } from '../../packages/server/src/services/hermes/run-chat/multi-agent-routing'
import { generateTaskPlan, generateTaskRouteDecision, streamTaskRouteReasoning } from '../../packages/server/src/services/task-planner'

vi.mock('../../packages/server/src/services/task-planner', () => ({
  generateTaskPlan: vi.fn(),
  generateTaskRouteDecision: vi.fn(),
  streamTaskRouteReasoning: vi.fn(),
}))

const candidates: MultiAgentRouteCandidate[] = [
  {
    id: 'ask-data-agent',
    name: '问数智能体',
    description: '负责 SQL、报表、案件数据和业务系统查询',
    baseUrl: 'http://127.0.0.1:8767',
    enabled: true,
    skills: [{ name: 'case_data_query', description: '查询数据库并汇总涉案信息' }],
    tools: [{ name: 'talktome-db-query', description: '执行问数和案件数据查询工具' }],
  },
]

describe('multi-agent runtime routing', () => {
  beforeEach(() => {
    vi.mocked(generateTaskRouteDecision).mockReset()
    vi.mocked(generateTaskPlan).mockReset()
    vi.mocked(streamTaskRouteReasoning).mockReset()
    vi.mocked(streamTaskRouteReasoning).mockResolvedValue({
      provider: 'mock-provider',
      model: 'mock-model',
    })
    vi.mocked(generateTaskPlan).mockResolvedValue({
      title: '涉案信息查询规划',
      summary: '由问数智能体执行数据查询并返回阶段结果。',
      planner_provider: 'mock-provider',
      planner_model: 'mock-model',
      plan: {
        tasks: [
          {
            id: 'query_case_info',
            phase: '执行',
            title: '查询涉案信息',
            description: '按用户输入查询对应案件数据，并返回结构化结果。',
            status: 'draft',
            recommended_agent_id: 'ask-data-agent',
            recommended_agent_name: '问数智能体',
            dependencies: [],
            acceptance_criteria: ['返回可展示的查询结果或缺失条件'],
          },
        ],
        dependencies: [],
        agent_routes: [
          {
            task_id: 'query_case_info',
            agent_id: 'ask-data-agent',
            agent_name: '问数智能体',
            reason: '具备案件数据查询能力',
            confidence: 0.93,
          },
        ],
        risks: ['需要子智能体校验数据源权限'],
        acceptance_criteria: ['返回查询结果或明确失败原因'],
      },
    })
  })

  it('delegates to a matched sub-agent even when the router model misclassifies the task as direct', async () => {
    vi.mocked(generateTaskRouteDecision).mockResolvedValue({
      intent: 'case_info_query',
      category: '数据任务',
      execution_mode: 'direct',
      need_clarify: false,
      selected_agent_id: null,
      selected_agent_name: null,
      confidence: 0.42,
      reason: '直接回答用户无法查询个人涉案信息。',
      todo: [],
      constraints: ['涉及个人信息，需要注意授权。'],
      planner_provider: 'mock-provider',
      planner_model: 'mock-model',
    })

    const decision = await resolveMultiAgentRoute({
      enabled: true,
      input: '查询一下张三的涉案信息',
      candidates,
      profile: 'default',
      provider: 'mock-provider',
      model: 'mock-model',
    })

    expect(decision.executionMode).toBe('delegate_subagent')
    expect(decision.selectedAgent?.id).toBe('ask-data-agent')
    expect(decision.reason).toContain('运行时能力匹配')
    expect(decision.todo).toEqual([
      '确认用户查询目标与可用数据源',
      '将任务交给问数智能体执行',
      '接收子智能体阶段结果并汇总回复',
    ])
    expect(decision.delegatedNodeIds).toEqual(['task_query_case_info'])
    expect(generateTaskPlan).toHaveBeenCalledOnce()
  })
})
