import { describe, expect, it } from 'vitest'
import { sanitizeAgentDisplayText } from '../../packages/client/src/utils/agent-display-text'

describe('sanitizeAgentDisplayText', () => {
  it('removes dcp-id tags from side-panel text', () => {
    expect(sanitizeAgentDisplayText('执行中 <dcp-id>abc</dcp-id> 已完成')).toBe('执行中 已完成')
  })

  it('drops hidden think blocks while preserving visible body text', () => {
    expect(sanitizeAgentDisplayText('开始<think>不要展示</think>结束')).toBe('开始结束')
  })
})
