import { describe, expect, it } from 'vitest'
import {
  applySubagentEvent,
  applyTerminalEvent,
  type CollaborationSnapshotState,
} from '../../packages/server/src/services/hermes/run-chat/collaboration-state'

function makeSnapshot(): CollaborationSnapshotState {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    mode: 'delegate_subagent',
    intent: 'query_case',
    category: '数据任务',
    reason: '委派问数智能体执行',
    text: '委派问数智能体执行',
    objective: '查询涉案信息',
    status: 'running',
    currentNodeId: 'query_case',
    selectedAgentId: 'data-agent',
    selectedAgentName: '问数智能体',
    todo: ['查询涉案信息', '汇总结果'],
    constraints: [],
    planNodes: [
      {
        id: 'understand',
        title: '理解需求与约束',
        phase: '分析',
        status: 'done',
        outcome: 'success',
        dependsOn: [],
        executor: { type: 'hermes', name: '主智能体' },
        summary: '已理解需求',
      },
      {
        id: 'route',
        title: '确认执行路径',
        phase: '路由',
        status: 'done',
        outcome: 'success',
        dependsOn: ['understand'],
        executor: { type: 'hermes', name: '主智能体' },
        summary: '已确认路径',
      },
      {
        id: 'query_case',
        title: '查询涉案信息',
        phase: '执行',
        status: 'doing',
        outcome: 'unknown',
        dependsOn: ['route'],
        executor: { type: 'subagent', id: 'data-agent', name: '问数智能体' },
        summary: '执行中',
      },
      {
        id: 'summarize_case',
        title: '汇总涉案结果',
        phase: '汇总',
        status: 'todo',
        outcome: 'unknown',
        dependsOn: ['query_case'],
        executor: { type: 'hermes', name: '主智能体' },
        summary: '等待查询节点完成',
      },
      {
        id: 'respond',
        title: '汇总阶段成果并回复用户',
        phase: '汇总',
        status: 'todo',
        outcome: 'unknown',
        dependsOn: ['summarize_case'],
        executor: { type: 'hermes', name: '主智能体' },
        summary: '等待汇总',
      },
    ],
    planDependencies: [
      { from: 'understand', to: 'route', type: 'blocks' },
      { from: 'route', to: 'query_case', type: 'blocks' },
      { from: 'query_case', to: 'summarize_case', type: 'blocks' },
      { from: 'summarize_case', to: 'respond', type: 'blocks' },
    ],
    activity: [],
    thinkingSteps: [
      { id: 'understand', title: '理解用户需求', detail: 'done', status: 'done' },
      { id: 'route', title: '生成路由决策', detail: 'done', status: 'done' },
      { id: 'match', title: '确认执行路径', detail: 'done', status: 'done' },
    ],
    startedAt: Date.now(),
    endedAt: null,
  }
}

describe('collaboration-state grounding guard projection', () => {
  it('keeps unsafe delegated node visible instead of marking it green success', () => {
    const next = applySubagentEvent(makeSnapshot(), 'subagent.complete', {
      status: 'partial',
      node_status: 'partial',
      grounding_status: 'unsafe_to_finalize',
      finalizable: false,
      subagent_id: 'data-agent',
      agent_name: '问数智能体',
      plan_node_ids: ['query_case'],
      summary: '只返回部分结果，禁止直接汇总',
    })

    const node = next.planNodes.find(item => item.id === 'query_case')
    const summarize = next.planNodes.find(item => item.id === 'summarize_case')
    const respond = next.planNodes.find(item => item.id === 'respond')
    expect(node?.status).toBe('unsafe')
    expect(node?.outcome).toBe('unsafe')
    expect(summarize?.status).toBe('waiting_replan')
    expect(summarize?.outcome).toBe('failure')
    expect(respond?.status).toBe('waiting_replan')
    expect(next.status).toBe('running')
    expect(next.currentNodeId).toBe('query_case')
  })

  it('does not overwrite partial / unsafe nodes during terminal completion', () => {
    const snapshot = makeSnapshot()
    snapshot.planNodes = snapshot.planNodes.map(node => node.id === 'query_case'
      ? { ...node, status: 'partial', outcome: 'partial', summary: '结果被截断' }
      : node)

    const next = applyTerminalEvent(snapshot, 'completed', {
      output: '当前结果不足以形成最终结论。',
    })

    const node = next.planNodes.find(item => item.id === 'query_case')
    expect(node?.status).toBe('partial')
    expect(node?.outcome).toBe('partial')
  })

  it('invalidates downstream completed nodes when upstream delegated node later fails', () => {
    const snapshot = makeSnapshot()
    snapshot.planNodes = snapshot.planNodes.map(node => {
      if (node.id === 'summarize_case' || node.id === 'respond') {
        return {
          ...node,
          status: 'done' as const,
          outcome: 'success' as const,
          summary: '旧计划误标成功',
        }
      }
      return node
    })

    const next = applySubagentEvent(snapshot, 'subagent.complete', {
      status: 'failed',
      node_status: 'failed',
      summary: '数据库暂不可用',
      blocked_plan_node_ids: ['summarize_case', 'respond'],
      plan_node_ids: ['query_case'],
    })

    expect(next.planNodes.find(item => item.id === 'query_case')?.status).toBe('failed')
    expect(next.planNodes.find(item => item.id === 'summarize_case')?.status).toBe('invalidated')
    expect(next.planNodes.find(item => item.id === 'respond')?.status).toBe('invalidated')
    expect(next.status).toBe('running')
  })

  it('converts waiting_replan nodes to skipped when the run eventually fails', () => {
    const snapshot = makeSnapshot()
    snapshot.planNodes = snapshot.planNodes.map(node => {
      if (node.id === 'query_case') {
        return {
          ...node,
          status: 'failed' as const,
          outcome: 'failure' as const,
          summary: '数据源不可用',
        }
      }
      if (node.id === 'summarize_case' || node.id === 'respond') {
        return {
          ...node,
          status: 'waiting_replan' as const,
          outcome: 'failure' as const,
          summary: '等待重新规划',
        }
      }
      return node
    })

    const next = applyTerminalEvent(snapshot, 'failed', {
      error: 'sub-agent 问数智能体 failed: 数据源不可用',
    })

    expect(next.planNodes.find(item => item.id === 'query_case')?.status).toBe('failed')
    expect(next.planNodes.find(item => item.id === 'summarize_case')?.status).toBe('skipped')
    expect(next.planNodes.find(item => item.id === 'respond')?.status).toBe('skipped')
  })
})
