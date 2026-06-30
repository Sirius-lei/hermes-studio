import { parseThinking } from './thinking-parser'

export function sanitizeAgentDisplayText(value: string) {
  if (!value) return ''

  const withoutDcp = value
    .replace(/<dcp-id\b[^>]*>[\s\S]*?<\/dcp-id>/gi, '')
    .replace(/<\/?dcp-id\b[^>]*>/gi, '')

  const parsed = parseThinking(withoutDcp, { streaming: false })
  return parsed.body
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
