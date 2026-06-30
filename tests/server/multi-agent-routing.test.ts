import { describe, expect, it } from 'vitest'
import {
  buildExecutionPlanFromTaskPlanner,
  pickDominantPlannedAgent,
  type MultiAgentRouteCandidate,
} from '../../packages/server/src/services/hermes/run-chat/multi-agent-routing'
import type { GeneratedTaskPlan } from '../../packages/server/src/services/task-planner'

const candidates: MultiAgentRouteCandidate[] = [
  {
    id: 'ask-data-agent',
    name: '问数智能体',
    description: '负责 SQL、报表和数据分析',
    baseUrl: 'http://127.0.0.1:8767',
    enabled: true,
    skills: [{ name: 'db_query_protocol', description: '查询数据库并汇总结果' }],
    tools: [{ name: 'talktome-db-query', description: '执行问数工具' }],
  },
  {
    id: 'doc-agent',
    name: '文档智能体',
    description: '负责资料整理与文档输出',
    enabled: true,
    skills: [{ name: 'doc_write', description: '整理文档' }],
    tools: [],
  },
]

function createGeneratedPlan(): GeneratedTaskPlan {
  return {
    title: '海关月报规划',
    summary: '先确认统计口径，再由问数智能体查询数据，最后整理月报结论。',
    planner_provider: 'mock-provider',
    planner_model: 'mock-model',
    plan: {
      tasks: [
        {
          id: 'clarify_scope',
          phase: '分析',
          title: '确认统计口径',
          description: '明确月份、字段、统计维度与输出格式。',
          status: 'draft',
          recommended_agent_id: null,
          recommended_agent_name: null,
          dependencies: [],
          acceptance_criteria: ['明确统计月份', '明确输出维度'],
        },
        {
          id: 'query_monthly_report',
          phase: '执行',
          title: '查询月报数据',
          description: '按统计口径查询案件、查获、涉案主体等数据。',
          status: 'draft',
          recommended_agent_id: 'ask-data-agent',
          recommended_agent_name: '问数智能体',
          dependencies: ['clarify_scope'],
          acceptance_criteria: ['返回结构化查询结果'],
        },
      ],
      dependencies: [
        { from: 'clarify_scope', to: 'query_monthly_report', type: 'blocks' },
      ],
      agent_routes: [
        {
          task_id: 'query_monthly_report',
          agent_id: 'ask-data-agent',
          agent_name: '问数智能体',
          reason: '具备 SQL 查询与报表汇总能力',
          confidence: 0.92,
        },
      ],
      risks: ['数据库连接可能未配置'],
      acceptance_criteria: ['输出月报结论'],
    },
  }
}

describe('multi-agent routing planner mapping', () => {
  it('picks the dominant planned sub-agent from planner routes', () => {
    const picked = pickDominantPlannedAgent(createGeneratedPlan().plan, candidates)
    expect(picked?.agent.id).toBe('ask-data-agent')
    expect(picked?.taskIds).toEqual(['query_monthly_report'])
    expect(picked?.averageConfidence).toBeCloseTo(0.92)
  })

  it('maps generated planner tasks into visible execution nodes', () => {
    const executionPlan = buildExecutionPlanFromTaskPlanner({
      generated: createGeneratedPlan(),
      routeText: '多智能体协作：主智能体已完成任务规划。',
      candidates,
    })

    expect(executionPlan.nodes.map(node => node.id)).toEqual([
      'understand',
      'route',
      'task_clarify_scope',
      'task_query_monthly_report',
      'respond',
    ])
    expect(executionPlan.nodes[2]).toMatchObject({
      title: '确认统计口径',
      phase: '分析',
      status: 'todo',
      executor: { type: 'hermes', name: 'Hermes' },
    })
    expect(executionPlan.nodes[3]).toMatchObject({
      title: '查询月报数据',
      phase: '执行',
      status: 'todo',
      executor: { type: 'subagent', id: 'ask-data-agent', name: '问数智能体' },
    })
  })
})
