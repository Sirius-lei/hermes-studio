import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SUB_AGENT_STORAGE_KEY,
  readStoredSubAgents,
  recordSubAgentInvocationComplete,
  recordSubAgentInvocationStart,
  writeStoredSubAgents,
} from '../../packages/client/src/utils/subagent-storage'

describe('subagent storage analytics', () => {
  beforeEach(() => {
    if (typeof window === 'undefined') {
      const store: Record<string, string> = {}
      ;(globalThis as any).window = {
        localStorage: {
          getItem: vi.fn((key: string) => store[key] ?? null),
          setItem: vi.fn((key: string, value: string) => { store[key] = value }),
          removeItem: vi.fn((key: string) => { delete store[key] }),
          clear: vi.fn(() => { for (const key of Object.keys(store)) delete store[key] }),
        },
        dispatchEvent: vi.fn(),
      }
      ;(globalThis as any).CustomEvent = class {
        type: string
        constructor(type: string) {
          this.type = type
        }
      }
    }
    window.localStorage.clear()
    vi.clearAllMocks()
  })

  it('tracks call count, recent invocations, success rate and average latency', () => {
    writeStoredSubAgents([{
      id: 'ask-data-agent',
      name: '问数智能体',
      callCount: 0,
      successRate: 0,
      avgLatencyMs: 0,
      recentInvocations: [],
    }])

    recordSubAgentInvocationStart({
      sessionId: 'session-a',
      runId: 'run-1',
      agentId: 'ask-data-agent',
      agentName: '问数智能体',
      task: '查询 8 月月报',
    })

    recordSubAgentInvocationComplete({
      sessionId: 'session-a',
      runId: 'run-1',
      agentId: 'ask-data-agent',
      agentName: '问数智能体',
      status: 'completed',
      summary: '已返回 8 月月报摘要',
      durationSeconds: 2.4,
    })

    const records = readStoredSubAgents<any>()
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      SUB_AGENT_STORAGE_KEY,
      expect.any(String),
    )
    expect(records).toHaveLength(1)
    expect(records[0].callCount).toBe(1)
    expect(records[0].successRate).toBe(100)
    expect(records[0].avgLatencyMs).toBe(2400)
    expect(records[0].recentInvocations).toHaveLength(1)
    expect(records[0].recentInvocations[0]).toMatchObject({
      status: 'completed',
      task: '查询 8 月月报',
      summary: '已返回 8 月月报摘要',
    })
  })

  it('counts failed runs without inflating success rate', () => {
    writeStoredSubAgents([{
      id: 'ask-data-agent',
      name: '问数智能体',
      callCount: 0,
      successRate: 0,
      avgLatencyMs: 0,
      recentInvocations: [],
    }])

    recordSubAgentInvocationStart({
      sessionId: 'session-b',
      runId: 'run-2',
      agentId: 'ask-data-agent',
      task: '查询涉案主体',
    })

    recordSubAgentInvocationComplete({
      sessionId: 'session-b',
      runId: 'run-2',
      agentId: 'ask-data-agent',
      status: 'failed',
      summary: '连接数据库失败',
      durationSeconds: 1.2,
    })

    const records = readStoredSubAgents<any>()
    expect(records[0].callCount).toBe(1)
    expect(records[0].successRate).toBe(0)
    expect(records[0].avgLatencyMs).toBe(1200)
    expect(records[0].recentInvocations[0]).toMatchObject({
      status: 'failed',
      summary: '连接数据库失败',
    })
  })
})
