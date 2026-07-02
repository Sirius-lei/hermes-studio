import { describe, expect, it } from 'vitest'
import {
  buildSubagentSessionId,
  resolveSubagentAssistantContent,
  sanitizeSubagentDisplayText,
} from '../../packages/server/src/services/hermes/run-chat/handle-subagent-run'

describe('handle subagent run helpers', () => {
  it('normalizes delegated subagent session ids to a conservative runtime-safe format', () => {
    expect(buildSubagentSessionId('mr03:7f5l/e5am67', 'data:agent')).toBe('hermes-mr03-7f5l-e5am67-data-agent')
    expect(buildSubagentSessionId(':::bad:::', '***')).toBe('hermes-bad')
  })

  it('keeps direct assistant output when the subagent returns visible text', () => {
    expect(resolveSubagentAssistantContent({
      output: '这里是子智能体的最终答复',
      agentName: '问数智能体',
      goal: '查询 8 月月报',
      toolCount: 2,
      hadActivity: true,
      lastEventText: '工具执行完成',
    })).toBe('这里是子智能体的最终答复')
  })

  it('does not treat a prefatory one-liner as the final answer when real activity followed', () => {
    expect(resolveSubagentAssistantContent({
      output: '好的，我先查阅元数据。',
      agentName: '问数智能体',
      goal: '查询 8 月月报',
      toolCount: 2,
      hadActivity: true,
      lastEventText: '已读取 8 月数据并完成汇总',
    })).toBe('好的，我先查阅元数据。 子智能体「问数智能体」已完成当前任务。 阶段结果：已读取 8 月数据并完成汇总。 详细过程见右侧协作面板。')
  })

  it('synthesizes a minimal summary when only structured activity events are returned', () => {
    expect(resolveSubagentAssistantContent({
      output: '',
      agentName: '问数智能体',
      goal: '查询 8 月月报',
      toolCount: 2,
      hadActivity: true,
      lastEventText: '已读取 8 月数据并完成汇总',
    })).toContain('子智能体「问数智能体」已完成当前任务。')
  })

  it('still fails when the subagent returns neither content nor activity', () => {
    expect(resolveSubagentAssistantContent({
      output: '',
      agentName: '问数智能体',
      goal: '查询 8 月月报',
      toolCount: 0,
      hadActivity: false,
      lastEventText: '',
    })).toBe('')
  })

  it('strips hidden dcp tags and think blocks from delegated subagent output', () => {
    expect(sanitizeSubagentDisplayText('结果 <dcp-id>internal</dcp-id> 可见')).toBe('结果 可见')
    expect(sanitizeSubagentDisplayText('前缀 <think>隐藏推理</think> 结论')).toBe('前缀 结论')
  })
})
