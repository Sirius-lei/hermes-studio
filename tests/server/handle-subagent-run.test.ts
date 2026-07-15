import { describe, expect, it } from 'vitest'
import {
  buildSubagentSessionId,
  resolveSubagentAssistantContent,
  resolveSubagentArtifactUrl,
  sanitizeSubagentDisplayText,
} from '../../packages/server/src/services/DiTing/run-chat/handle-subagent-run'

describe('handle subagent run helpers', () => {
  it('normalizes delegated subagent session ids to a conservative runtime-safe format', () => {
    expect(buildSubagentSessionId('mr03:7f5l/e5am67', 'data:agent')).toBe('DiTing-mr03:7f5l-e5am67-data:agent')
    expect(buildSubagentSessionId(':::bad:::', '***')).toBe('DiTing-bad')
  })

  it('keeps direct assistant output visible while blocking ungrounded finalization', () => {
    const result = resolveSubagentAssistantContent({
      output: '这里是子智能体的最终答复',
      agentName: '问数智能体',
      goal: '查询 8 月月报',
      toolCount: 2,
      hadActivity: true,
      lastEventText: '工具执行完成',
    })

    expect(result.assistantContent).toBe('这里是子智能体的最终答复')
    expect(result.completed).toBe(false)
    expect(result.status).toBe('partial')
    expect(result.finalizable).toBe(false)
  })

  it('does not treat a prefatory one-liner as the final answer when real activity followed', () => {
    const result = resolveSubagentAssistantContent({
      output: '好的，我先查阅元数据。',
      agentName: '问数智能体',
      goal: '查询 8 月月报',
      toolCount: 2,
      hadActivity: true,
      lastEventText: '已读取 8 月数据并完成汇总',
    })

    expect(result.assistantContent).toContain('子智能体「问数智能体」已完成当前任务。')
    expect(result.assistantContent).toContain('阶段结果：已读取 8 月数据并完成汇总。')
  })

  it('dedupes repeated delegated text blocks before persisting them to the main chat', () => {
    const result = resolveSubagentAssistantContent({
      output: '已定位数据源。\n命中 3 条记录。\n已定位数据源。\n命中 3 条记录。',
      agentName: '问数智能体',
      goal: '查询 8 月月报',
      toolCount: 1,
      hadActivity: true,
      lastEventText: '已接收节点任务',
    })

    expect(result.assistantContent).toBe('已定位数据源。\n命中 3 条记录。')
  })

  it('synthesizes a minimal summary when only structured activity events are returned', () => {
    const result = resolveSubagentAssistantContent({
      output: '',
      agentName: '问数智能体',
      goal: '查询 8 月月报',
      toolCount: 2,
      hadActivity: true,
      lastEventText: '已读取 8 月数据并完成汇总',
    })

    expect(result.assistantContent).toContain('子智能体「问数智能体」已完成当前任务。')
  })

  it('still fails when the subagent returns neither content nor activity', () => {
    const result = resolveSubagentAssistantContent({
      output: '',
      agentName: '问数智能体',
      goal: '查询 8 月月报',
      toolCount: 0,
      hadActivity: false,
      lastEventText: '',
    })

    expect(result.assistantContent).toBe('')
    expect(result.completed).toBe(false)
  })

  it('returns clarify_required content from structured output', () => {
    const result = resolveSubagentAssistantContent({
      output: JSON.stringify({
        status: 'clarify_required',
        completed: false,
        summary: '需要补充查询对象标识',
        visible_output: '',
        blockers: ['缺少身份证号'],
        evidence: [],
        clarification: {
          question: '请补充身份证号或手机号后四位。',
          reason: '当前姓名重名，无法继续检索。',
          required_fields: ['身份证号', '手机号后四位'],
          acceptable_any_of: true,
        },
      }),
      agentName: '问数智能体',
      goal: '查询涉案信息',
      toolCount: 1,
      hadActivity: true,
      lastEventText: '等待补充信息',
    })

    expect(result.status).toBe('clarify_required')
    expect(result.completed).toBe(false)
    expect(result.assistantContent).toContain('请补充身份证号或手机号后四位。')
    expect(result.clarification?.requiredFields).toEqual(['身份证号', '手机号后四位'])
  })

  it('downgrades natural-language-only delegated output to partial and blocks finalization', () => {
    const result = resolveSubagentAssistantContent({
      output: JSON.stringify({
        status: 'completed',
        completed: true,
        grounding_status: 'verified',
        output_completeness: 'full',
        finalizable: true,
        summary: '已找到相关涉案记录摘要',
        visible_output: '仅返回摘要，没有完整结构化结果。',
        blockers: [],
        evidence: ['命中 3 条涉案记录摘要'],
      }),
      agentName: '问数智能体',
      goal: '查询涉案信息',
      toolCount: 2,
      hadActivity: true,
      lastEventText: '命中 3 条涉案记录摘要',
    })

    expect(result.status).toBe('partial')
    expect(result.completed).toBe(false)
    expect(result.finalizable).toBe(false)
    expect(result.groundingStatus).toBe('unsafe_to_finalize')
    expect(result.blockers.some(item => item.includes('artifact') || item.includes('structured_output'))).toBe(true)
  })

  it('does not accept delegated task echo as a real node result even when artifacts are present', () => {
    const result = resolveSubagentAssistantContent({
      output: JSON.stringify({
        status: 'completed',
        completed: true,
        grounding_status: 'verified',
        output_completeness: 'full',
        finalizable: true,
        summary: '问数智能体已接收“执行涉案信息查询”节点任务。当前目标：执行涉案信息查询。',
        visible_output: '问数智能体已接收“执行涉案信息查询”节点任务。当前目标：执行涉案信息查询。',
        blockers: [],
        evidence: [],
        artifacts: [],
      }),
      agentName: '问数智能体',
      goal: '执行涉案信息查询',
      toolCount: 1,
      hadActivity: true,
      lastEventText: 'publish_runtime_artifact 已生成 cases.csv',
      artifacts: [{
        artifactId: 'art_1',
        filename: 'cases.csv',
        downloadPath: '/api/files/download/art_1',
      }],
    })

    expect(result.assistantContent).not.toContain('当前目标')
    expect(result.assistantContent).toContain('cases.csv')
    expect(result.completed).toBe(false)
    expect(result.status).toBe('partial')
    expect(result.finalizable).toBe(false)
  })

  it('blocks artifact-only delegated completion from becoming finalizable', () => {
    const result = resolveSubagentAssistantContent({
      output: JSON.stringify({
        status: 'completed',
        completed: true,
        grounding_status: 'verified',
        output_completeness: 'full',
        finalizable: true,
        summary: '已导出案件清单文件',
        visible_output: '已导出案件清单文件。',
        blockers: [],
        evidence: ['已生成 cases.csv'],
        artifacts: [{
          artifact_id: 'art_2',
          filename: 'cases.csv',
          download_path: '/api/files/download/art_2',
        }],
      }),
      agentName: '问数智能体',
      goal: '导出案件清单',
      toolCount: 1,
      hadActivity: true,
      lastEventText: '已导出 cases.csv',
    })

    expect(result.completed).toBe(false)
    expect(result.status).toBe('partial')
    expect(result.finalizable).toBe(false)
    expect(result.blockers.some(item => item.includes('structured_output'))).toBe(true)
  })

  it('keeps verified structured delegated output finalizable', () => {
    const result = resolveSubagentAssistantContent({
      output: JSON.stringify({
        status: 'completed',
        completed: true,
        grounding_status: 'verified',
        output_completeness: 'full',
        finalizable: true,
        summary: '已生成结构化案件清单',
        visible_output: '已整理出结构化案件清单，可继续汇总。',
        structured_output: {
          rows: [{ case_no: '(2026)沪01民初1号', role: '被告' }],
          total: 1,
        },
        blockers: [],
        evidence: ['案件编号已核验'],
      }),
      agentName: '问数智能体',
      goal: '查询涉案信息',
      toolCount: 2,
      hadActivity: true,
      lastEventText: '已生成结构化案件清单',
    })

    expect(result.status).toBe('completed')
    expect(result.completed).toBe(true)
    expect(result.finalizable).toBe(true)
    expect(result.groundingStatus).toBe('verified')
    expect(result.structuredOutput).toEqual({
      rows: [{ case_no: '(2026)沪01民初1号', role: '被告' }],
      total: 1,
    })
  })

  it('strips hidden dcp tags and think blocks from delegated subagent output', () => {
    expect(sanitizeSubagentDisplayText('结果 <dcp-id>internal</dcp-id> 可见')).toBe('结果 可见')
    expect(sanitizeSubagentDisplayText('前缀 <think>隐藏推理</think> 结论')).toBe('前缀 结论')
  })

  it('normalizes relative subagent artifact download urls against the subagent base url', () => {
    expect(resolveSubagentArtifactUrl('http://subagent.test/', {
      filename: 'cases.csv',
      downloadUrl: '/api/files/download/art_1',
    })).toBe('http://subagent.test/api/files/download/art_1')

    expect(resolveSubagentArtifactUrl('http://subagent.test', {
      filename: 'cases.csv',
      downloadPath: 'api/files/download/art_2',
    })).toBe('http://subagent.test/api/files/download/art_2')
  })
})
