import { randomUUID } from 'crypto'
import type { Server, Socket } from 'socket.io'
import { addMessage, createSession, getSession, updateSessionStats } from '../../../db/DiTing/session-store'
import {
  deletePendingSubagentTask,
  type PendingSubagentTaskRecord,
  upsertPendingSubagentTask,
} from '../../../db/DiTing/pending-subagent-task-store'
import { updateUsage } from '../../../db/DiTing/usage-store'
import { logger } from '../../logger'
import { contentBlocksToString, extractTextForPreview } from './content-blocks'
import { getOrCreateSession, pushState } from './compression'
import { calcAndUpdateUsage } from './usage'
import type { ContentBlock, SessionState } from './types'
import { resolveMultiAgentReplan, type MultiAgentRouteCandidate, type MultiAgentRouteDecision } from './multi-agent-routing'
import { effectiveSessionOwnerId } from '../session-access'

interface SubagentRunSocketData {
  input: string | ContentBlock[]
  display_input?: string | ContentBlock[] | null
  display_role?: 'user' | 'command'
  storage_message?: string
  session_id?: string
  model?: string
  provider?: string
  workspace?: string | null
  source?: string
  session_source?: 'global_agent' | 'workflow'
  queue_id?: string
  collaboration_run_id?: string
  sub_agent_candidates?: MultiAgentRouteCandidate[]
  resume_pending_subagent_task?: PendingSubagentTaskRecord | null
  onEvent?: (event: string, payload: any) => void
}

interface SubagentContinuationOptions {
  continueWithDiTing?: (args: {
    input: string
    instructions: string
    collaborationRunId?: string
    objective?: string
  }) => Promise<void>
}

interface SubagentStreamTextState {
  inThink: boolean
  inDcpId: boolean
  pendingText: string
}

function previewText(value: unknown, limit = 220): string {
  let text = ''
  if (typeof value === 'string') {
    text = value
  } else {
    try {
      text = JSON.stringify(value, ensureAsciiSafe, 2)
    } catch {
      text = String(value ?? '')
    }
  }
  const cleaned = sanitizeSubagentDisplayText(text)
  return cleaned.length <= limit ? cleaned : `${cleaned.slice(0, limit)}...`
}

function ensureAsciiSafe(_key: string, value: unknown) {
  return value
}

function normalizeChatUrl(baseUrl: string, chatPath?: string) {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '')
  const normalizedPath = String(chatPath || '/v1/chat/completions').trim() || '/v1/chat/completions'
  if (/^https?:\/\//i.test(normalizedPath)) return normalizedPath
  return `${normalizedBase}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`
}

function requestedUserContextFromSocket(socket: Socket): string | null {
  const value = typeof socket.handshake.query?.user_id === 'string'
    ? socket.handshake.query.user_id.trim()
    : ''
  return value || null
}

function sanitizeSubagentSessionIdPart(value: string) {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[^A-Za-z0-9]+$/, '')
}

export function buildSubagentSessionId(sessionId: string, agentId: string) {
  const parts = [
    'DiTing',
    sanitizeSubagentSessionIdPart(sessionId),
    sanitizeSubagentSessionIdPart(agentId),
  ].filter(Boolean)
  const joined = parts.join('-').slice(0, 120)
  const normalized = joined.replace(/[^A-Za-z0-9]+$/, '')
  return normalized || 'DiTing-subagent'
}

function lowerAscii(char: string) {
  if (char >= 'A' && char <= 'Z') return char.toLowerCase()
  return char
}

function equalAsciiInsensitive(a: string, b: string) {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (lowerAscii(a[index]) !== lowerAscii(b[index])) return false
  }
  return true
}

function indexAsciiInsensitive(text: string, needle: string) {
  if (!needle) return 0
  if (text.length < needle.length) return -1
  for (let index = 0; index <= text.length - needle.length; index += 1) {
    if (equalAsciiInsensitive(text.slice(index, index + needle.length), needle)) return index
  }
  return -1
}

function suffixTagPrefixLen(text: string, tag: string) {
  let max = tag.length - 1
  if (text.length < max) max = text.length
  for (let length = max; length > 0; length -= 1) {
    if (equalAsciiInsensitive(text.slice(text.length - length), tag.slice(0, length))) return length
  }
  return 0
}

function stripHiddenModelTags(text: string) {
  let next = text
  while (next) {
    const start = indexAsciiInsensitive(next, '<dcp-id')
    if (start < 0) return next
    const endOpen = next.slice(start).indexOf('>')
    if (endOpen < 0) return next.slice(0, start)
    const afterOpen = start + endOpen + 1
    const closeIndex = indexAsciiInsensitive(next.slice(afterOpen), '</dcp-id>')
    if (closeIndex < 0) return next.slice(0, start)
    next = `${next.slice(0, start)}${next.slice(afterOpen + closeIndex + '</dcp-id>'.length)}`
  }
  return next
}

export function sanitizeSubagentDisplayText(text: string) {
  return stripHiddenModelTags(text)
    .replace(/<\/?dcp-id\b[^>]*>/gi, '')
    .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(think|thinking|reasoning)>/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeSubagentAssistantOutput(text: string) {
  return dedupeRepeatedParagraphs(
    sanitizeSubagentDisplayText(text)
  )
    .replace(/^(?:#{1,6}\s*)?节点\s*\d+\s*执行结果[^\n]*\n+/gim, '')
    .replace(/^(?:#{1,6}\s*)?阶段\s*[一二三四五六七八九十0-9]+\s*(?:执行结果|阶段成果)[^\n]*\n+/gim, '')
    .replace(/^(?:#{1,6}\s*)?当前节点(?:执行)?结果[^\n]*\n+/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function collapseRepeatedText(text: string) {
  const normalized = sanitizeSubagentDisplayText(text).trim()
  if (!normalized) return ''

  for (let repeat = 2; repeat <= 4; repeat += 1) {
    if (normalized.length % repeat !== 0) continue
    const chunkLength = normalized.length / repeat
    const chunk = normalized.slice(0, chunkLength).trim()
    if (!chunk) continue
    let repeated = true
    for (let index = 1; index < repeat; index += 1) {
      if (normalized.slice(index * chunkLength, (index + 1) * chunkLength).trim() !== chunk) {
        repeated = false
        break
      }
    }
    if (repeated) return chunk
  }

  const lines = normalized
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '')
  for (let repeat = 2; repeat <= 4; repeat += 1) {
    if (lines.length < repeat || lines.length % repeat !== 0) continue
    const chunkSize = lines.length / repeat
    const chunk = lines.slice(0, chunkSize)
    const chunkKey = chunk.map(line => line.replace(/\s+/g, ' ').trim()).join('\n')
    if (!chunkKey) continue
    let repeated = true
    for (let index = 1; index < repeat; index += 1) {
      const candidateKey = lines
        .slice(index * chunkSize, (index + 1) * chunkSize)
        .map(line => line.replace(/\s+/g, ' ').trim())
        .join('\n')
      if (candidateKey !== chunkKey) {
        repeated = false
        break
      }
    }
    if (repeated) return chunk.join('\n').trim()
  }

  return normalized
}

function dedupeRepeatedParagraphs(text: string) {
  const normalized = collapseRepeatedText(text)
  if (!normalized) return ''
  const blocks = normalized
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
  if (blocks.length <= 1) return normalized
  const next: string[] = []
  let previousKey = ''
  for (const block of blocks) {
    const key = block.replace(/\s+/g, ' ').trim()
    if (key && key === previousKey) continue
    previousKey = key
    next.push(block)
  }
  const lines = next.join('\n\n')
    .split('\n')
    .map(line => line.trimEnd())
  const dedupedLines: string[] = []
  let previousLineKey = ''
  for (const line of lines) {
    const key = line.replace(/\s+/g, ' ').trim()
    if (key && key === previousLineKey) continue
    if (key) previousLineKey = key
    dedupedLines.push(line)
  }
  return collapseRepeatedText(dedupedLines.join('\n').trim())
}

function flushSubagentVisibleText(state: SubagentStreamTextState, flush: boolean) {
  const openTag = '<think>'
  const closeTag = '</think>'
  const dcpOpenTag = '<dcp-id'
  const dcpCloseTag = '</dcp-id>'
  let visible = ''

  while (state.pendingText !== '') {
    if (state.inDcpId) {
      const closeIndex = indexAsciiInsensitive(state.pendingText, dcpCloseTag)
      if (closeIndex >= 0) {
        state.pendingText = state.pendingText.slice(closeIndex + dcpCloseTag.length)
        state.inDcpId = false
        continue
      }
      const keep = flush ? 0 : suffixTagPrefixLen(state.pendingText, dcpCloseTag)
      state.pendingText = keep > 0 ? state.pendingText.slice(-keep) : ''
      return visible
    }

    if (state.inThink) {
      const closeIndex = indexAsciiInsensitive(state.pendingText, closeTag)
      if (closeIndex >= 0) {
        state.pendingText = state.pendingText.slice(closeIndex + closeTag.length)
        state.inThink = false
        continue
      }
      const keep = flush ? 0 : suffixTagPrefixLen(state.pendingText, closeTag)
      state.pendingText = keep > 0 ? state.pendingText.slice(-keep) : ''
      return visible
    }

    const thinkIndex = indexAsciiInsensitive(state.pendingText, openTag)
    const dcpIndex = indexAsciiInsensitive(state.pendingText, dcpOpenTag)

    if (thinkIndex >= 0 && (dcpIndex < 0 || thinkIndex < dcpIndex)) {
      visible += stripHiddenModelTags(state.pendingText.slice(0, thinkIndex))
      state.pendingText = state.pendingText.slice(thinkIndex + openTag.length)
      state.inThink = true
      continue
    }

    if (dcpIndex >= 0) {
      visible += stripHiddenModelTags(state.pendingText.slice(0, dcpIndex))
      const endOpen = state.pendingText.slice(dcpIndex).indexOf('>')
      if (endOpen < 0) {
        state.pendingText = flush ? '' : state.pendingText.slice(dcpIndex)
        return visible
      }
      state.pendingText = state.pendingText.slice(dcpIndex + endOpen + 1)
      state.inDcpId = true
      continue
    }

    const keep = flush
      ? 0
      : Math.max(
          suffixTagPrefixLen(state.pendingText, openTag),
          suffixTagPrefixLen(state.pendingText, dcpOpenTag),
        )
    const sliceEnd = state.pendingText.length - keep
    visible += stripHiddenModelTags(state.pendingText.slice(0, sliceEnd))
    state.pendingText = state.pendingText.slice(sliceEnd)
    return visible
  }

  return visible
}

interface SubagentStreamSummary {
  output: string
  toolCount: number
  hadActivity: boolean
  lastEventText: string
  artifacts: StructuredSubagentArtifact[]
}

type StructuredSubagentNodeStatus = 'completed' | 'clarify_required' | 'blocked' | 'failed' | 'partial'
type StructuredGroundingStatus = 'verified' | 'partial' | 'truncated' | 'unverified' | 'unsafe_to_finalize'
type StructuredOutputCompleteness = 'full' | 'partial' | 'truncated' | 'empty'

interface StructuredSubagentClarification {
  question: string
  reason: string
  requiredFields: string[]
  acceptableAnyOf: boolean
}

interface StructuredSubagentArtifact {
  artifactId?: string
  filename: string
  downloadUrl?: string
  downloadPath?: string
  workspacePath?: string
  contentType?: string
  size?: number
}

type StructuredSubagentObject = Record<string, unknown>

interface StructuredSubagentNodeResult {
  status: StructuredSubagentNodeStatus
  completed: boolean
  summary: string
  visibleOutput: string
  blockers: string[]
  evidence: string[]
  clarification: StructuredSubagentClarification | null
  artifacts: StructuredSubagentArtifact[]
  groundingStatus: StructuredGroundingStatus
  outputCompleteness: StructuredOutputCompleteness
  finalizable: boolean
  structuredOutput: StructuredSubagentObject | null
  guardReason: string
  raw: StructuredSubagentObject | null
}

function normalizeCompactText(value: string) {
  return value.replace(/\s+/g, '').trim()
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => sanitizeSubagentDisplayText(String(item ?? '')).trim())
    .filter(Boolean)
}

function objectValue(value: unknown): StructuredSubagentObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as StructuredSubagentObject
}

function extractJsonObjectText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const candidate = fenced?.[1]?.trim() || trimmed
  if (candidate.startsWith('{') && candidate.endsWith('}')) return candidate
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) return candidate.slice(start, end + 1)
  return null
}

function normalizeStructuredNodeStatus(value: unknown): StructuredSubagentNodeStatus {
  const normalized = sanitizeSubagentDisplayText(String(value ?? '')).toLowerCase()
  if (
    normalized === 'completed'
    || normalized === 'clarify_required'
    || normalized === 'blocked'
    || normalized === 'failed'
    || normalized === 'partial'
  ) {
    return normalized
  }
  return 'completed'
}

function normalizeGroundingStatus(value: unknown): StructuredGroundingStatus {
  const normalized = sanitizeSubagentDisplayText(String(value ?? '')).trim().toLowerCase()
  if (
    normalized === 'verified'
    || normalized === 'partial'
    || normalized === 'truncated'
    || normalized === 'unverified'
    || normalized === 'unsafe_to_finalize'
  ) {
    return normalized
  }
  return 'unverified'
}

function normalizeOutputCompleteness(value: unknown): StructuredOutputCompleteness {
  const normalized = sanitizeSubagentDisplayText(String(value ?? '')).trim().toLowerCase()
  if (
    normalized === 'full'
    || normalized === 'partial'
    || normalized === 'truncated'
    || normalized === 'empty'
  ) {
    return normalized
  }
  return 'empty'
}

function normalizeStructuredClarification(value: unknown): StructuredSubagentClarification | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const question = sanitizeSubagentDisplayText(String(raw.question ?? '')).trim()
  const reason = sanitizeSubagentDisplayText(String(raw.reason ?? '')).trim()
  const requiredFields = stringArray(raw.required_fields ?? raw.requiredFields)
  const acceptableAnyOf = raw.acceptable_any_of === true || raw.acceptableAnyOf === true
  if (!question && !reason && requiredFields.length === 0) return null
  return {
    question,
    reason,
    requiredFields,
    acceptableAnyOf,
  }
}

function normalizeStructuredArtifact(value: unknown): StructuredSubagentArtifact | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const artifactId = sanitizeSubagentDisplayText(String(raw.artifact_id ?? raw.artifactId ?? '')).trim() || undefined
  const filename = sanitizeSubagentDisplayText(
    String(raw.filename ?? raw.name ?? raw.download_name ?? raw.downloadName ?? ''),
  ).trim()
  const downloadUrl = sanitizeSubagentDisplayText(String(raw.download_url ?? raw.downloadUrl ?? '')).trim() || undefined
  const downloadPath = sanitizeSubagentDisplayText(String(raw.download_path ?? raw.downloadPath ?? '')).trim() || undefined
  const workspacePath = sanitizeSubagentDisplayText(
    String(raw.workspace_path ?? raw.workspacePath ?? raw.path ?? ''),
  ).trim() || undefined
  const contentType = sanitizeSubagentDisplayText(String(raw.content_type ?? raw.contentType ?? '')).trim() || undefined
  const sizeValue = Number(raw.size ?? raw.bytes)
  const size = Number.isFinite(sizeValue) && sizeValue >= 0 ? sizeValue : undefined
  const fallbackName = filename
    || (downloadUrl ? downloadUrl.split('/').pop() || '' : '')
    || (workspacePath ? workspacePath.split('/').pop() || '' : '')
    || artifactId
    || ''
  if (!fallbackName && !downloadUrl && !downloadPath && !workspacePath) return null
  return {
    artifactId,
    filename: fallbackName || 'artifact',
    downloadUrl,
    downloadPath,
    workspacePath,
    contentType,
    size,
  }
}

function structuredArtifacts(value: unknown): StructuredSubagentArtifact[] {
  if (Array.isArray(value)) {
    return value
      .map(item => normalizeStructuredArtifact(item))
      .filter((item): item is StructuredSubagentArtifact => Boolean(item))
  }
  const single = normalizeStructuredArtifact(value)
  return single ? [single] : []
}

const SUBAGENT_TRUNCATION_PATTERNS = [
  /截断/,
  /省略/,
  /未完整(?:展开|返回|输出)?/,
  /仅摘要/,
  /部分结果/,
  /结果不完整/,
  /后续缺失/,
  /summary\s*only/i,
  /truncat(?:ed|ion)/i,
  /partial(?:ly)?\s+(?:returned|complete|result)/i,
]

function detectTruncationReason(values: Array<unknown>) {
  const text = values
    .map(value => sanitizeSubagentDisplayText(String(value ?? '')).trim())
    .filter(Boolean)
    .join('\n')
  if (!text) return ''
  const match = SUBAGENT_TRUNCATION_PATTERNS.find(pattern => pattern.test(text))
  if (!match) return ''
  return '子智能体返回内容存在截断或仅部分结果，当前不能作为最终汇总依据。'
}

function hasStructuredPayload(value: StructuredSubagentObject | null) {
  return Boolean(value && Object.keys(value).length > 0)
}

function deriveOutputCompleteness(args: {
  explicit: StructuredOutputCompleteness
  status: StructuredSubagentNodeStatus
  visibleOutput: string
  summary: string
  truncationReason: string
}) {
  if (args.explicit !== 'empty') return args.explicit
  if (args.truncationReason) return 'truncated'
  if (args.status === 'clarify_required' || args.status === 'failed' || args.status === 'blocked' || args.status === 'partial') {
    return args.visibleOutput || args.summary ? 'partial' : 'empty'
  }
  return args.visibleOutput || args.summary ? 'full' : 'empty'
}

function deriveGroundingStatus(args: {
  explicit: StructuredGroundingStatus
  truncationReason: string
  hasStructuredEvidencePayload: boolean
  status: StructuredSubagentNodeStatus
}) {
  if (args.explicit !== 'unverified') return args.explicit
  if (args.truncationReason) return 'truncated'
  if (!args.hasStructuredEvidencePayload && args.status === 'completed') return 'unverified'
  if (args.hasStructuredEvidencePayload && args.status === 'completed') return 'verified'
  if (args.status === 'partial') return 'partial'
  return 'unverified'
}

function ensureUniqueStrings(values: string[]) {
  return [...new Set(values.map(value => sanitizeSubagentDisplayText(value).trim()).filter(Boolean))]
}

function mergeStructuredArtifacts(...groups: Array<StructuredSubagentArtifact[]>) {
  const merged = new Map<string, StructuredSubagentArtifact>()
  for (const group of groups) {
    for (const artifact of group || []) {
      const key = [
        artifact.artifactId || '',
        artifact.downloadUrl || '',
        artifact.downloadPath || '',
        artifact.workspacePath || '',
        artifact.filename || '',
      ].join('|')
      if (!key.trim()) continue
      if (!merged.has(key)) merged.set(key, artifact)
    }
  }
  return [...merged.values()]
}

function extractArtifactsFromRuntimePayload(value: unknown): StructuredSubagentArtifact[] {
  if (!value) return []
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      return extractArtifactsFromRuntimePayload(parsed)
    } catch {
      return []
    }
  }
  if (Array.isArray(value)) {
    return mergeStructuredArtifacts(...value.map(item => extractArtifactsFromRuntimePayload(item)))
  }
  if (typeof value !== 'object') return []
  const raw = value as Record<string, unknown>
  return mergeStructuredArtifacts(
    structuredArtifacts(raw.artifacts),
    structuredArtifacts(raw.artifact),
    extractArtifactsFromRuntimePayload(raw.text),
    extractArtifactsFromRuntimePayload(
      Array.isArray(raw.content)
        ? raw.content
            .map((item) => {
              if (!item || typeof item !== 'object' || Array.isArray(item)) return null
              const record = item as Record<string, unknown>
              return record.text
            })
            .filter((item): item is unknown => item != null)
        : null,
    ),
    structuredArtifacts(raw.details && typeof raw.details === 'object' ? (raw.details as Record<string, unknown>).artifacts : null),
    structuredArtifacts(raw.details && typeof raw.details === 'object' ? (raw.details as Record<string, unknown>).artifact : null),
    extractArtifactsFromRuntimePayload(raw.details && typeof raw.details === 'object' ? (raw.details as Record<string, unknown>).text : null),
    extractArtifactsFromRuntimePayload(
      raw.details && typeof raw.details === 'object'
        ? (raw.details as Record<string, unknown>).content
        : null,
    ),
  )
}

function buildGroundingGuardResult(input: StructuredSubagentNodeResult): StructuredSubagentNodeResult {
  if (input.status === 'clarify_required') {
    return {
      ...input,
      completed: false,
      finalizable: false,
    }
  }

  const hasStructuredEvidencePayload = hasStructuredPayload(input.structuredOutput)
  const hasArtifactPayload = input.artifacts.length > 0
  const truncationReason = detectTruncationReason([
    input.summary,
    input.visibleOutput,
    ...input.blockers,
    ...input.evidence,
  ])
  const outputCompleteness = deriveOutputCompleteness({
    explicit: input.outputCompleteness,
    status: input.status,
    visibleOutput: input.visibleOutput,
    summary: input.summary,
    truncationReason,
  })
  const groundingStatus = deriveGroundingStatus({
    explicit: input.groundingStatus,
    truncationReason,
    hasStructuredEvidencePayload,
    status: input.status,
  })

  const guardReasons = ensureUniqueStrings([
    input.guardReason,
    truncationReason,
    !hasStructuredEvidencePayload && !hasArtifactPayload && input.status === 'completed'
      ? '当前节点未交付 artifact 或 structured_output，禁止直接汇总最终结论。'
      : '',
    hasArtifactPayload && !hasStructuredEvidencePayload
      ? '当前节点只交付了 artifact 元数据，尚未提供可供主智能体复核的 structured_output。'
      : '',
    groundingStatus === 'unverified'
      ? '当前节点结果仍未校验完成，暂不允许主智能体生成确定性结论。'
      : '',
    groundingStatus === 'unsafe_to_finalize'
      ? '当前节点结果证据不足，禁止直接进入最终汇总。'
      : '',
    outputCompleteness === 'partial'
      ? '当前节点仅返回部分结果，仍需继续补齐。'
      : '',
    outputCompleteness === 'truncated'
      ? '当前节点结果存在截断，必须先获取完整结构化产物。'
      : '',
  ])

  const finalizable = input.status === 'completed'
    && input.completed
    && groundingStatus === 'verified'
    && outputCompleteness === 'full'
    && hasStructuredEvidencePayload
    && input.finalizable !== false
    && guardReasons.length === 0

  if (input.status === 'failed' || input.status === 'blocked') {
    return {
      ...input,
      completed: false,
      groundingStatus,
      outputCompleteness,
      finalizable: false,
      guardReason: guardReasons[0] || input.guardReason,
      blockers: ensureUniqueStrings([...input.blockers, ...guardReasons]),
    }
  }

  if (!finalizable) {
    return {
      ...input,
      status: input.status === 'partial' ? 'partial' : 'partial',
      completed: false,
      groundingStatus: groundingStatus === 'verified' ? 'unsafe_to_finalize' : groundingStatus,
      outputCompleteness,
      finalizable: false,
      guardReason: guardReasons[0] || input.guardReason,
      blockers: ensureUniqueStrings([...input.blockers, ...guardReasons]),
    }
  }

  return {
    ...input,
    completed: true,
    groundingStatus,
    outputCompleteness,
    finalizable: true,
    guardReason: '',
    blockers: input.blockers,
  }
}

function parseStructuredSubagentNodeResult(output: string): StructuredSubagentNodeResult | null {
  const jsonText = extractJsonObjectText(output)
  if (!jsonText) return null
  try {
    const raw = JSON.parse(jsonText) as Record<string, unknown>
    const status = normalizeStructuredNodeStatus(raw.status)
    const clarification = normalizeStructuredClarification(raw.clarification)
    const completed = status === 'clarify_required'
      ? false
      : (raw.completed === true || status === 'completed')
    return buildGroundingGuardResult({
      status,
      completed,
      summary: sanitizeSubagentDisplayText(String(raw.summary ?? '')).trim(),
      visibleOutput: sanitizeSubagentDisplayText(String(raw.visible_output ?? raw.visibleOutput ?? '')).trim(),
      blockers: stringArray(raw.blockers),
      evidence: stringArray(raw.evidence),
      clarification,
      artifacts: [
        ...structuredArtifacts(raw.artifacts),
        ...structuredArtifacts(raw.artifact),
      ],
      groundingStatus: normalizeGroundingStatus(raw.grounding_status ?? raw.groundingStatus),
      outputCompleteness: normalizeOutputCompleteness(raw.output_completeness ?? raw.outputCompleteness),
      finalizable: raw.finalizable !== false,
      structuredOutput: objectValue(raw.structured_output ?? raw.structuredOutput),
      guardReason: sanitizeSubagentDisplayText(String(raw.guard_reason ?? raw.guardReason ?? '')).trim(),
      raw,
    })
  } catch {
    return null
  }
}

function clarificationOutput(args: {
  visibleOutput: string
  summary: string
  clarification: StructuredSubagentClarification | null
}) {
  if (args.visibleOutput) return args.visibleOutput
  if (!args.clarification) return args.summary
  const lines = [
    args.clarification.question,
    args.clarification.reason && args.clarification.reason !== args.clarification.question
      ? args.clarification.reason
      : '',
    args.clarification.requiredFields.length > 0
      ? `请补充：${args.clarification.requiredFields.join('、')}${args.clarification.acceptableAnyOf ? '（任选其一即可）' : ''}`
      : '',
  ].filter(Boolean)
  return lines.join('\n')
}

function looksLikePrefatorySubagentText(text: string) {
  const normalized = normalizeCompactText(sanitizeSubagentDisplayText(text))
  if (!normalized) return false
  if (normalized.length > 80) return false
  if (/^(好的?|收到|明白|了解|行|ok|okay|sure|alright|gotit|roger)[,，。.!！?？]*/i.test(normalized)) return true
  if (
    /^(我先|先|正在|马上|稍等|让我先|我先来|先来|先去|开始)(查阅|查看|核对|确认|分析|定位|检索|搜索|搜集|整理|读取|处理|执行|查询)/.test(normalized)
  ) {
    return true
  }
  if (
    /(我先|先|正在)(查阅元数据|查看元数据|读取元数据|确认数据源|定位数据源|查数据源|看数据源|分析一下|先处理一下)/.test(normalized)
  ) {
    return true
  }
  return false
}

function looksLikeDelegatedTaskEcho(text: string, goal: string) {
  const normalized = normalizeCompactText(sanitizeSubagentDisplayText(text))
  if (!normalized) return false
  if (
    /已接收[“"].+节点任务/.test(text)
    || /当前目标[:：]/.test(text)
    || /我会根据回执决定是否继续执行/.test(text)
    || /返回原始命中记录或结构化查询结果/.test(text)
    || /结果中包含可用于区分是否同一主体的关键字段/.test(text)
    || /我会根据回执决定是否继续执行、重试或重规划/.test(text)
  ) {
    return true
  }
  const normalizedGoal = normalizeCompactText(goal)
  if (normalizedGoal && normalized.includes(normalizedGoal) && /验收[:：]|基于已确认的查询条件|节点任务/.test(text)) {
    return true
  }
  return false
}

function normalizeDelegatedResultField(text: string, goal: string) {
  const normalized = normalizeSubagentAssistantOutput(text)
  if (!normalized) return ''
  return looksLikeDelegatedTaskEcho(normalized, goal) ? '' : normalized
}

export function resolveSubagentAssistantContent(args: {
  output: string
  agentName: string
  goal: string
  toolCount: number
  hadActivity: boolean
  lastEventText: string
  artifacts?: StructuredSubagentArtifact[]
}): StructuredSubagentNodeResult & { assistantContent: string } {
  const parsedStructured = parseStructuredSubagentNodeResult(args.output)
  const structured = parsedStructured
    ? {
        ...parsedStructured,
        summary: normalizeDelegatedResultField(parsedStructured.summary, args.goal),
        visibleOutput: normalizeDelegatedResultField(parsedStructured.visibleOutput, args.goal),
        guardReason: normalizeSubagentAssistantOutput(parsedStructured.guardReason),
      }
    : null
  const structuredEchoDetected = Boolean(
    parsedStructured
    && (
      (parsedStructured.summary && !structured?.summary)
      || (parsedStructured.visibleOutput && !structured?.visibleOutput)
    )
  )
  const runtimeArtifacts = mergeStructuredArtifacts(args.artifacts || [], structured?.artifacts || [])
  const directSource = structured
    ? (
        clarificationOutput({
          visibleOutput: structured.visibleOutput || '',
          summary: structured.summary || '',
          clarification: structured.clarification || null,
        }) || structured.summary
      )
    : args.output
  const direct = normalizeSubagentAssistantOutput(directSource)
  const looksLikeEcho = looksLikeDelegatedTaskEcho(direct, args.goal)
  const useStructuredFallback =
    !!direct
    && args.hadActivity
    && looksLikePrefatorySubagentText(direct)
  if (structured?.status === 'clarify_required') {
    const clarifyText = direct
      || clarificationOutput({
        visibleOutput: structured.visibleOutput,
        summary: structured.summary,
        clarification: structured.clarification,
      })
      || structured.summary
      || args.lastEventText
      || args.goal
    return {
      status: 'clarify_required',
      completed: false,
      summary: structured.summary || clarifyText,
      visibleOutput: clarifyText,
      blockers: structured.blockers,
      evidence: structured.evidence,
      clarification: structured.clarification,
      artifacts: runtimeArtifacts,
      groundingStatus: structured.groundingStatus,
      outputCompleteness: structured.outputCompleteness,
      finalizable: false,
      structuredOutput: structured.structuredOutput,
      guardReason: structured.guardReason,
      raw: structured.raw,
      assistantContent: clarifyText,
    }
  }
  if (direct && !useStructuredFallback && !looksLikeEcho) {
    const guarded = buildGroundingGuardResult({
      status: structured?.status || 'completed',
      completed: structured?.completed ?? true,
      summary: structured?.summary || direct,
      visibleOutput: structured?.visibleOutput || direct,
      blockers: structured?.blockers || [],
      evidence: structured?.evidence || [],
      clarification: structured?.clarification || null,
      artifacts: runtimeArtifacts,
      groundingStatus: structured?.groundingStatus || 'unverified',
      outputCompleteness: structured?.outputCompleteness || 'empty',
      finalizable: structured?.finalizable ?? true,
      structuredOutput: structured?.structuredOutput || null,
      guardReason: structured?.guardReason || (structuredEchoDetected ? '当前节点仅返回任务回显，未提供实际执行结果。' : ''),
      raw: structured?.raw || null,
    })
    return {
      ...guarded,
      assistantContent: direct,
    }
  }
  if (!args.hadActivity) {
    return {
      status: structured?.status || 'failed',
      completed: structured?.completed ?? false,
      summary: structured?.summary || '',
      visibleOutput: structured?.visibleOutput || '',
      blockers: structured?.blockers || [],
      evidence: structured?.evidence || [],
      clarification: structured?.clarification || null,
      artifacts: runtimeArtifacts,
      groundingStatus: structured?.groundingStatus || 'unverified',
      outputCompleteness: structured?.outputCompleteness || 'empty',
      finalizable: false,
      structuredOutput: structured?.structuredOutput || null,
      guardReason: structured?.guardReason || '',
      raw: structured?.raw || null,
      assistantContent: '',
    }
  }

  const segments: string[] = []
  const artifactSummary = runtimeArtifacts.length > 0
    ? `已生成 ${runtimeArtifacts.length} 个交付文件：${runtimeArtifacts.slice(0, 3).map(item => item.filename).join('、')}。`
    : ''
  if (direct && !looksLikeEcho) segments.push(direct)
  if (structured?.completed === false) {
    segments.push(`子智能体「${args.agentName}」未完成当前节点。`)
    if (structured.blockers.length > 0) segments.push(`阻塞：${structured.blockers.join('；')}。`)
  } else {
    segments.push(`子智能体「${args.agentName}」已完成当前任务。`)
  }
  if (structured?.summary) {
    segments.push(`阶段结果：${structured.summary}。`)
  } else if (artifactSummary) {
    segments.push(artifactSummary)
  } else if (args.lastEventText) {
    segments.push(`阶段结果：${args.lastEventText}。`)
  } else if (args.toolCount > 0) {
    segments.push(`本次共执行 ${args.toolCount} 次工具调用。`)
  } else if (args.goal) {
    segments.push(`目标：${args.goal}。`)
  }
  const assistantContent = segments.join(' ')
  const guarded = buildGroundingGuardResult({
    status: structured?.status || 'completed',
    completed: structured?.completed ?? true,
    summary: structured?.summary || artifactSummary || (looksLikeEcho ? '' : direct) || args.lastEventText || args.goal,
    visibleOutput: structured?.visibleOutput || (looksLikeEcho ? '' : direct) || artifactSummary || assistantContent,
    blockers: structured?.blockers || [],
    evidence: structured?.evidence || [],
    clarification: structured?.clarification || null,
    artifacts: runtimeArtifacts,
    groundingStatus: structured?.groundingStatus || 'unverified',
    outputCompleteness: structured?.outputCompleteness || 'empty',
    finalizable: structured?.finalizable ?? true,
    structuredOutput: structured?.structuredOutput || null,
    guardReason: structured?.guardReason || (structuredEchoDetected ? '当前节点仅返回任务回显，未提供实际执行结果。' : ''),
    raw: structured?.raw || null,
  })
  return {
    ...guarded,
    assistantContent,
  }
}

export function resolveSubagentArtifactUrl(baseUrl: string, artifact: StructuredSubagentArtifact) {
  const direct = String(artifact.downloadUrl || '').trim()
  const relative = String(artifact.downloadPath || '').trim()
  const candidate = direct || relative
  if (!candidate) return ''
  if (/^https?:\/\//i.test(candidate)) return candidate
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '')
  const normalizedPath = candidate.startsWith('/') ? candidate : `/${candidate}`
  return `${normalizedBase}${normalizedPath}`
}

function buildSubagentAssistantMessageContent(args: {
  assistantContent: string
  artifacts: StructuredSubagentArtifact[]
  baseUrl: string
}): string {
  const fileBlocks: Array<Extract<ContentBlock, { type: 'file' }>> = args.artifacts
    .map((artifact) => {
      const path = resolveSubagentArtifactUrl(args.baseUrl, artifact)
      if (!path) return null
      return {
        type: 'file' as const,
        name: artifact.filename,
        path,
        ...(artifact.contentType ? { media_type: artifact.contentType } : {}),
      }
    })
    .filter((block): block is Extract<ContentBlock, { type: 'file' }> => Boolean(block))

  if (fileBlocks.length === 0) return args.assistantContent

  const deliveryLines = fileBlocks.map((block) => `- ${block.name}`)
  const text = [
    args.assistantContent.trim() || `已生成 ${fileBlocks.length} 个交付文件。`,
    '交付文件：',
    ...deliveryLines,
  ].join('\n')

  return JSON.stringify([
    { type: 'text', text },
    ...fileBlocks,
  ])
}

function subagentGoal(decision: MultiAgentRouteDecision) {
  const activeNode = resolveActiveDelegatedPlanNodes(decision)[0]
  if (activeNode) {
    return [activeNode.title, activeNode.summary].filter(Boolean).join(' - ') || decision.summary || decision.inputText || '执行用户请求'
  }
  return decision.summary || decision.inputText || '执行用户请求'
}

function delegatedPlanNodes(decision: MultiAgentRouteDecision) {
  if (!decision.plan || decision.delegatedNodeIds.length === 0) return []
  const delegatedNodeIdSet = new Set(decision.delegatedNodeIds)
  return decision.plan.nodes.filter(node => delegatedNodeIdSet.has(node.id))
}

interface DelegatedPlanNodeDescriptor {
  id: string
  title: string
  phase: string
  summary: string
}

function isTerminalDelegatedPlanStatus(status: unknown) {
  const value = sanitizeSubagentDisplayText(String(status || '')).trim().toLowerCase()
  return value === 'done'
    || value === 'partial'
    || value === 'unsafe'
    || value === 'blocked'
    || value === 'failed'
    || value === 'waiting_replan'
    || value === 'invalidated'
    || value === 'skipped'
}

function describePlanNodes(decision: MultiAgentRouteDecision, nodeIds: string[]): DelegatedPlanNodeDescriptor[] {
  if (!decision.plan || nodeIds.length === 0) return []
  const nodeIdSet = new Set(nodeIds.filter(Boolean))
  return decision.plan.nodes
    .filter(node => nodeIdSet.has(node.id))
    .map(node => ({
      id: node.id,
      title: sanitizeSubagentDisplayText(String(node.title || '')).trim() || node.id,
      phase: sanitizeSubagentDisplayText(String(node.phase || '')).trim() || '执行',
      summary: sanitizeSubagentDisplayText(String(node.summary || '')).trim(),
    }))
}

function collectDependentPlanNodeIds(decision: MultiAgentRouteDecision, sourceNodeIds: string[]): string[] {
  if (!decision.plan || sourceNodeIds.length === 0) return []
  const dependencies = (decision.plan.dependencies || []).filter(dependency => dependency.type === 'blocks')
  if (dependencies.length === 0) return []
  const sourceSet = new Set(sourceNodeIds.filter(Boolean))
  const queued = [...sourceSet]
  const visited = new Set<string>()
  const blocked = new Set<string>()

  while (queued.length > 0) {
    const current = queued.shift() || ''
    if (!current) continue
    for (const dependency of dependencies) {
      if (dependency.from !== current) continue
      const nextNodeId = String(dependency.to || '').trim()
      if (!nextNodeId || sourceSet.has(nextNodeId) || visited.has(nextNodeId)) continue
      visited.add(nextNodeId)
      blocked.add(nextNodeId)
      queued.push(nextNodeId)
    }
  }

  return decision.plan.nodes
    .filter(node => blocked.has(node.id) && node.id !== 'understand' && node.id !== 'route')
    .map(node => node.id)
}

function buildBlockedPlanNodePayload(decision: MultiAgentRouteDecision, blockedNodeIds: string[], reason: string) {
  const blockedNodes = describePlanNodes(decision, blockedNodeIds)
  if (blockedNodes.length === 0) return {}
  return {
    blocked_plan_node_ids: blockedNodes.map(node => node.id),
    blocked_plan_node_titles: blockedNodes.map(node => node.title),
    dependency_gate_reason: normalizeFailureReasonText(reason) || '前置节点未完成，后续节点已暂停',
    recovery_action: 'waiting_replan',
  }
}

function summarizeBlockedNodeTitles(decision: MultiAgentRouteDecision, blockedNodeIds: string[]) {
  const titles = describePlanNodes(decision, blockedNodeIds)
    .map(node => node.title)
    .filter(Boolean)
  if (titles.length === 0) return ''
  if (titles.length === 1) return `后续依赖节点“${titles[0]}”已暂停`
  if (titles.length === 2) return `后续依赖节点“${titles[0]}”和“${titles[1]}”已暂停`
  return `后续依赖节点“${titles[0]}”等 ${titles.length} 个节点已暂停`
}

function isDelegatedNodeReady(decision: MultiAgentRouteDecision, nodeId: string) {
  if (!decision.plan) return false
  const node = decision.plan.nodes.find(item => item.id === nodeId)
  const nodeStatus = String(node?.status || '')
  if (!node || isTerminalDelegatedPlanStatus(nodeStatus)) return false
  const blockingDependencies = (decision.plan.dependencies || []).filter(dependency => dependency.to === node.id && dependency.type === 'blocks')
  return blockingDependencies.every((dependency) => {
    const dependencyNode = decision.plan?.nodes.find(item => item.id === dependency.from)
    return !dependencyNode || dependencyNode.status === 'done'
  })
}

function resolveActiveDelegatedPlanNodes(decision: MultiAgentRouteDecision) {
  const delegatedNodes = delegatedPlanNodes(decision)
  if (delegatedNodes.length === 0) return []
  const runningNodes = delegatedNodes.filter(node => node.status === 'doing')
  if (runningNodes.length > 0) return runningNodes.slice(0, 1)
  const readyNode = delegatedNodes.find(node => isDelegatedNodeReady(decision, node.id))
  return readyNode ? [readyNode] : []
}

function activeDelegatedNodeIds(decision: MultiAgentRouteDecision) {
  return resolveActiveDelegatedPlanNodes(decision).map(node => node.id)
}

function buildDelegatedContinuationDecision(
  decision: MultiAgentRouteDecision,
  completedNodeIds: string[],
  observation: string,
): MultiAgentRouteDecision | null {
  if (!decision.plan || completedNodeIds.length === 0) return null
  const completedSet = new Set(completedNodeIds)
  const nextPlan = {
    ...decision.plan,
    nodes: decision.plan.nodes.map((node) => {
      if (node.id === 'understand' || node.id === 'route') {
        return { ...node, status: 'done' as const }
      }
      if (!completedSet.has(node.id)) return node
      return {
        ...node,
        status: 'done' as const,
        summary: previewText(observation, 240) || node.summary,
      }
    }),
  }
  const nextDecision: MultiAgentRouteDecision = {
    ...decision,
    plan: nextPlan,
  }
  const nextDelegatedNode = delegatedPlanNodes(nextDecision).find(node => isDelegatedNodeReady(nextDecision, node.id))
  if (!nextDelegatedNode) return null
  return {
    ...nextDecision,
    summary: nextDelegatedNode.summary || nextDecision.summary,
  }
}

function buildSubagentMessages(
  decision: MultiAgentRouteDecision,
  context?: {
    sessionId?: string
    taskId?: string
    latestUserInput?: string
    resumeTask?: PendingSubagentTaskRecord | null
  },
) {
  const delegatedPlanNodes = resolveActiveDelegatedPlanNodes(decision)
  const currentNode = delegatedPlanNodes[0] || null
  const currentNodeDependsOn = currentNode
    ? (decision.plan?.dependencies || [])
        .filter(dependency => dependency.to === currentNode.id)
        .map(dependency => dependency.from)
    : []
  const clarificationContext = context?.resumeTask
    ? {
        question: context.resumeTask.question,
        required_fields: context.resumeTask.required_fields,
        previous_visible_output: context.resumeTask.last_visible_output,
        previous_summary: context.resumeTask.last_result_summary,
        user_follow_up: context?.latestUserInput || '',
      }
    : null
  const system = [
    '你是被 DiTing Studio 选中的子智能体执行者。',
    `任务分类：${decision.category}`,
    `路由原因：${decision.reason}`,
    ...(delegatedPlanNodes.length > 0
      ? [
          '本次下发的任务清单：',
          ...delegatedPlanNodes
            .map((node, index) => `${index + 1}. [${node.phase}] ${node.title} - ${node.summary}`),
        ]
      : []),
    '你当前只处理一个节点任务，不要跨节点执行，不要越过当前节点直接给出整轮最终答复。',
    '如果 latest 用户消息看起来像“补充说明”“追加条件”“继续上一个问题”，必须结合 recent_session_context 理解，不要把它误判成全新的独立任务。',
    '不要把回复写成“节点1执行结果”“阶段一结果”“当前节点结果”等模板标题。',
    '除非用户明确要求，否则不要强行输出固定报告、固定表格或模板化章节。',
    '如果缺少用户输入才能继续，不要返回 blocked/failed，必须返回 clarify_required，并填写 clarification.question / clarification.reason / clarification.required_fields。',
    '如果数据为空、权限不足、工具失败或条件不足，返回未完成状态和阻塞原因。',
    '如果当前节点产出的是可下载文件或需要向主智能体交付文件，先把文件 publish 为 artifact，再把 artifact 元数据放进 artifacts。',
    '如果只拿到了部分结果、摘要结果、截断结果，必须显式返回 grounding_status=partial|truncated|unsafe_to_finalize，output_completeness=partial|truncated，并把 finalizable 设为 false。',
    '不要把聊天里展示用的截断文本当作最终产物。优先通过 structured_output 或 artifacts 交付可复核结果。',
    'summary / visible_output 只能写本节点真实执行得到的结果，禁止复述“已接收任务”“当前目标”“我将继续执行”这类任务回显文本。',
    '必须只返回一个 JSON 对象，不要输出 Markdown、解释文字或代码块。',
    'JSON schema: {"status":"completed|clarify_required|blocked|failed|partial","completed":boolean,"grounding_status":"verified|partial|truncated|unverified|unsafe_to_finalize","output_completeness":"full|partial|truncated|empty","finalizable":boolean,"summary":"string","visible_output":"string","structured_output":{},"blockers":["string"],"evidence":["string"],"guard_reason":"string","clarification":{"question":"string","reason":"string","required_fields":["string"],"acceptable_any_of":true},"artifacts":[{"artifact_id":"string","filename":"string","download_url":"string","download_path":"string","workspace_path":"string","content_type":"string","size":0}]}',
    '其中 completed=true 仅表示“当前节点任务已完成”，不是整轮任务已完成。',
    'visible_output 是给用户看的阶段成果正文；summary 是给主智能体的简要摘要；structured_output 是主智能体后续汇总优先读取的结构化结果；blockers 写未完成原因；evidence 写关键依据或结果点。',
    'status=clarify_required 时，completed 必须为 false，clarification 必须完整。',
    'artifacts 是可选字段；只有当当前节点真的产出了交付文件时才返回。',
    '只有当结果完整、可核验且可安全进入最终汇总时，grounding_status 才能为 verified，finalizable 才能为 true。',
  ].join('\n')
  const scopedUserPrompt = currentNode
    ? JSON.stringify({
        protocol: 'DiTing_node_task_v2',
        context_id: context?.sessionId || '',
        task_id: context?.taskId || '',
        original_user_request: decision.inputText,
        recent_session_context: decision.conversationContext || '',
        clarification_context: clarificationContext,
        current_node: {
          id: currentNode.id,
          phase: currentNode.phase,
          title: currentNode.title,
          summary: currentNode.summary,
          depends_on: currentNodeDependsOn,
          executor: currentNode.executor,
        },
        execution_rules: [
          '只执行 current_node，不跨节点。',
          '先完成当前节点，再返回 completed/status。',
          '若缺少用户补充，completed=false，status=clarify_required，并填写 clarification。',
          '若阻塞，completed=false，status=blocked 或 failed，并填写 blockers。',
        ],
        return_schema: {
          status: 'completed|clarify_required|blocked|failed|partial',
          completed: true,
          grounding_status: 'verified|partial|truncated|unverified|unsafe_to_finalize',
          output_completeness: 'full|partial|truncated|empty',
          finalizable: true,
          summary: '主智能体阅读摘要',
          visible_output: '给用户看的阶段成果',
          structured_output: {
            rows: [],
            metrics: {},
          },
          blockers: ['未完成原因'],
          evidence: ['关键依据或结果点'],
          guard_reason: '为什么当前结果不能直接进入最终汇总',
          clarification: {
            question: '请补充身份范围',
            reason: '当前条件不足以继续执行',
            required_fields: ['所在地区', '所属单位', '时间范围'],
            acceptable_any_of: true,
          },
          artifacts: [{
            artifact_id: 'art_xxx',
            filename: 'result.csv',
            download_url: 'http://127.0.0.1:8767/api/files/download/art_xxx',
            workspace_path: '/workspace/artifacts/art_xxx/result.csv',
            content_type: 'text/csv; charset=utf-8',
            size: 128,
          }],
        },
      }, null, 2)
    : decision.inputText
  return [
    { role: 'system', content: system },
    { role: 'user', content: scopedUserPrompt },
  ]
}

function buildIncompleteNodeRecoveryInstructions(
  decision: MultiAgentRouteDecision,
  result: StructuredSubagentNodeResult,
  blockedNodeIds: string[],
) {
  const base = decision.DiTingInstructions ? `${decision.DiTingInstructions}\n\n` : ''
  const blockedSummary = summarizeBlockedNodeTitles(decision, blockedNodeIds)
  return [
    base.trim(),
    '当前多智能体协作中的子智能体已返回，但没有完成当前节点任务。',
    '处理要求：',
    '- 不要把该节点标记为成功。',
    '- 先读取 blockers / evidence / artifacts / structured_output，再决定是向用户补充澄清、重新规划，还是改由主智能体接管。',
    '- 如果当前节点缺少必要条件，请直接向用户说明阻塞项。',
    '- 如果结果被标记为 partial/truncated/unverified/unsafe_to_finalize，禁止直接进入最终汇总。',
    '- 不要把失败诊断文案、visible_output 或主聊天区提示语当成后续事实输入。',
    '- 所有依赖当前节点输出的旧计划节点都已暂停；如需恢复，必须创建新的恢复节点或新的 plan revision。',
    `节点状态：${result.status}`,
    `grounding_status：${result.groundingStatus}`,
    `output_completeness：${result.outputCompleteness}`,
    `finalizable：${result.finalizable ? 'true' : 'false'}`,
    result.blockers.length > 0 ? `阻塞原因：${result.blockers.join('；')}` : '',
    blockedSummary ? `依赖门控：${blockedSummary}，等待重新规划。` : '',
  ].filter(Boolean).join('\n')
}

function buildIncompleteNodeRecoveryInput(args: {
  decision: MultiAgentRouteDecision
  currentNodeIds: string[]
  result: StructuredSubagentNodeResult
  blockedNodeIds: string[]
}) {
  return JSON.stringify({
    recovery_mode: 'delegated_node_incomplete',
    original_user_request: args.decision.inputText,
    failed_nodes: describePlanNodes(args.decision, args.currentNodeIds),
    blocked_downstream_nodes: describePlanNodes(args.decision, args.blockedNodeIds).map(node => ({
      ...node,
      status: 'waiting_replan',
    })),
    node_result: {
      status: args.result.status,
      completed: args.result.completed,
      grounding_status: args.result.groundingStatus,
      output_completeness: args.result.outputCompleteness,
      finalizable: args.result.finalizable,
      blockers: args.result.blockers,
      evidence: args.result.evidence,
      guard_reason: args.result.guardReason,
      structured_output: args.result.structuredOutput,
      artifacts: args.result.artifacts.map(item => ({
        artifact_id: item.artifactId || '',
        filename: item.filename,
        workspace_path: item.workspacePath || '',
        content_type: item.contentType || '',
        size: item.size || 0,
      })),
    },
    rules: [
      '不要把 failed node 的诊断文案、visible_output 或主聊天区失败提示当成后续事实输入。',
      '只有 structured_output 或 artifacts 才可作为可复用候选证据；若两者都为空，则视为没有可靠节点产物。',
      '任何依赖 failed node 的旧计划节点均已暂停，恢复时必须生成新的恢复节点或新的 plan revision。',
    ],
  }, ensureAsciiSafe, 2)
}

function buildFailureRecoveryInstructions(decision: MultiAgentRouteDecision, failure: string, blockedNodeIds: string[]) {
  const base = decision.DiTingInstructions ? `${decision.DiTingInstructions}\n\n` : ''
  const blockedSummary = summarizeBlockedNodeTitles(decision, blockedNodeIds)
  return [
    base.trim(),
    '当前多智能体执行中的子智能体节点已经失败。',
    '处理要求：',
    '- 立即终止上一版计划，不要继续沿用失败节点的执行状态。',
    '- 重新评估剩余工作，再决定是否生成新一版 Todo List 和执行节点。',
    '- 如果缺少必要条件或工具异常无法绕过，直接给用户说明阻塞原因和下一步所需条件。',
    '- 不要把失败节点标记为成功，也不要复用旧计划里的进行中节点。',
    '- 不要把失败诊断文案、主聊天区失败提示语或 visible_output 当成后续事实输入。',
    '- 所有依赖失败节点输出的旧计划节点都已暂停；恢复时必须创建新的恢复节点或新的 plan revision。',
    `失败摘要：${failure}`,
    blockedSummary ? `依赖门控：${blockedSummary}，等待重新规划。` : '',
  ].filter(Boolean).join('\n')
}

function buildFailureRecoveryInput(args: {
  decision: MultiAgentRouteDecision
  failedNodeIds: string[]
  failure: string
  blockedNodeIds: string[]
}) {
  return JSON.stringify({
    recovery_mode: 'delegated_node_failed',
    original_user_request: args.decision.inputText,
    failed_nodes: describePlanNodes(args.decision, args.failedNodeIds),
    blocked_downstream_nodes: describePlanNodes(args.decision, args.blockedNodeIds).map(node => ({
      ...node,
      status: 'waiting_replan',
    })),
    failure: {
      message: normalizeFailureReasonText(args.failure) || args.failure,
    },
    rules: [
      '请结束上一版失败计划，并重新判断后续是否还能继续执行。',
      '不要沿用旧计划里的 success / completed 状态，也不要把失败诊断文本当成后续分析输入。',
      '如果可以继续，请先生成新的协作计划；如果不能继续，请直接说明阻塞项。',
    ],
  }, ensureAsciiSafe, 2)
}

function resolveDelegatedNodeTitle(decision: MultiAgentRouteDecision, nodeIds: string[]) {
  const nodeIdSet = new Set(nodeIds)
  const match = (decision.plan?.nodes || []).find(node => nodeIdSet.has(node.id))
  return sanitizeSubagentDisplayText(String(match?.title || '')).trim() || '当前节点'
}

function normalizeFailureReasonText(value: string) {
  return sanitizeSubagentDisplayText(value)
    .replace(/[。.!！?？；;，,、\s]+$/g, '')
    .trim()
}

function previewStructuredObject(value: StructuredSubagentObject | null, limit = 320) {
  if (!value || Object.keys(value).length === 0) return ''
  try {
    return previewText(value, limit)
  } catch {
    return ''
  }
}

function buildSubagentGroundingObservation(result: StructuredSubagentNodeResult) {
  const segments = [
    result.summary ? `节点摘要：${result.summary}` : '',
    result.visibleOutput ? `阶段输出：${result.visibleOutput}` : '',
    result.evidence.length > 0 ? `关键依据：${result.evidence.join('；')}` : '',
    previewStructuredObject(result.structuredOutput) ? `结构化结果：${previewStructuredObject(result.structuredOutput)}` : '',
    result.artifacts.length > 0 ? `交付产物：${result.artifacts.map(item => item.filename).join('、')}` : '',
    `grounding_status=${result.groundingStatus}`,
    `output_completeness=${result.outputCompleteness}`,
    `finalizable=${result.finalizable ? 'true' : 'false'}`,
  ].filter(Boolean)
  return segments.join('\n')
}

function buildFinalizationBlockedFeedback(args: {
  decision: MultiAgentRouteDecision
  agentName: string
  reason: string
  blockedNodeIds: string[]
}) {
  const agentName = sanitizeSubagentDisplayText(args.agentName).trim() || '子智能体'
  const nodeTitle = resolveDelegatedNodeTitle(args.decision, activeDelegatedNodeIds(args.decision))
  const reason = normalizeFailureReasonText(args.reason) || '当前节点结果不完整'
  const blockedSummary = summarizeBlockedNodeTitles(args.decision, args.blockedNodeIds)
  return `${agentName}已回传“${nodeTitle}”节点结果，但当前结果不足以形成最终结论。原因是${reason}。${blockedSummary ? `${blockedSummary}，等待重新规划。` : ''}我会先阻断最终汇总，再尝试重试或重规划。`
}

function buildDelegatedFailureFeedback(args: {
  decision: MultiAgentRouteDecision
  nodeIds: string[]
  agentName: string
  reason: string
  recoverable: boolean
  blockedNodeIds?: string[]
}) {
  const agentName = sanitizeSubagentDisplayText(args.agentName).trim() || '子智能体'
  const nodeTitle = resolveDelegatedNodeTitle(args.decision, args.nodeIds)
  const reason = normalizeFailureReasonText(args.reason) || '当前节点执行未完成'
  const blockedSummary = summarizeBlockedNodeTitles(args.decision, args.blockedNodeIds || [])
  const nextStep = args.recoverable
    ? '我正在重新规划后续处理路径。'
    : '当前无法继续本轮任务，请检查失败原因或补充必要条件后再试。'
  return `${agentName}在“${nodeTitle}”节点执行失败，原因是${reason}。${blockedSummary ? `${blockedSummary}。` : ''}${nextStep}`
}

function mapPiMonoEvent(args: {
  kind: string
  event: Record<string, unknown>
  runId: string
  taskId: string
  subagentId: string
  agentName: string
  goal: string
  toolCount: number
}): { event: 'subagent.tool' | 'subagent.progress'; payload: Record<string, unknown>; nextToolCount: number } | null {
  const kind = args.kind
  const event = args.event
  const name = sanitizeSubagentDisplayText(String(event.name || event.tool_name || ''))
  const toolCallId = sanitizeSubagentDisplayText(String(event.id || event.tool_call_id || event.toolCallId || ''))
  const message = sanitizeSubagentDisplayText(String(event.message || event.status || event.kind || '').trim())
  const resultPreview = event.result != null ? previewText(event.result, 280) : ''
  const argumentsPreview = event.arguments != null ? previewText(event.arguments, 220) : ''

  if (
    kind === 'tool_call_start' ||
    kind === 'tool_call_end' ||
    kind.startsWith('tool_execution') ||
    kind === 'tool_result'
  ) {
    const nextToolCount = kind === 'tool_call_start' || kind === 'tool_execution_start'
      ? args.toolCount + 1
      : Math.max(1, args.toolCount)
    return {
      event: 'subagent.tool',
      nextToolCount,
      payload: {
        event: 'subagent.tool',
        run_id: args.runId,
        task_id: args.taskId,
        subagent_id: args.subagentId,
        agent_name: args.agentName,
        task_index: 0,
        task_count: 1,
        goal: args.goal,
        tool_call_id: toolCallId || undefined,
        tool_event_kind: kind,
        tool_name: name || 'tool',
        tool_count: nextToolCount,
        arguments: event.arguments,
        result: event.result,
        text: [message, resultPreview || argumentsPreview].filter(Boolean).join(' - ') || kind,
        status: String(event.status || kind),
      },
    }
  }

  return {
    event: 'subagent.progress',
    nextToolCount: args.toolCount,
    payload: {
      event: 'subagent.progress',
      run_id: args.runId,
      task_id: args.taskId,
      subagent_id: args.subagentId,
      agent_name: args.agentName,
      task_index: 0,
      task_count: 1,
      goal: args.goal,
      text: message || kind,
      status: String(event.status || kind),
    },
  }
}

async function streamSubagentCompletion(args: {
  url: string
  sessionId: string
  agentId: string
  taskId: string
  nodeId: string
  messages: Array<{ role: string; content: string }>
  emit: (event: string, payload: any) => void
  runId: string
  agentName: string
  goal: string
  recentContext?: string
  clarificationContext?: Record<string, unknown> | null
  emitVisibleOutput?: boolean
}): Promise<SubagentStreamSummary> {
  const subagentSessionId = buildSubagentSessionId(args.sessionId, args.agentId)
  const controller = new AbortController()
  const idleTimeoutMs = 90_000
  let idleTimedOut = false
  let idleTimer: NodeJS.Timeout | null = null
  const clearIdleTimer = () => {
    if (!idleTimer) return
    clearTimeout(idleTimer)
    idleTimer = null
  }
  const resetIdleTimer = () => {
    clearIdleTimer()
    idleTimer = setTimeout(() => {
      idleTimedOut = true
      controller.abort()
    }, idleTimeoutMs)
  }
  let response: Response
  try {
    resetIdleTimer()
    response = await fetch(args.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Pi-Mono-Session-Id': subagentSessionId,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'pi-mono',
        stream: true,
        timeout: 600,
        preserve_message_roles: true,
        session_id: subagentSessionId,
        task_id: args.taskId,
        node_id: args.nodeId,
        recent_context: args.recentContext || '',
        clarification_context: args.clarificationContext || null,
        messages: args.messages,
      }),
    })
  } catch (error) {
    clearIdleTimer()
    if (idleTimedOut) {
      throw new Error(`sub-agent stream idle timeout after ${Math.round(idleTimeoutMs / 1000)}s`)
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`fetch failed for ${args.url}: ${message}`)
  }

  if (!response.ok) {
    clearIdleTimer()
    const text = await response.text()
    throw new Error(text || `sub-agent runtime returned HTTP ${response.status}`)
  }
  if (!response.body) {
    clearIdleTimer()
    throw new Error('sub-agent runtime returned an empty body')
  }
  resetIdleTimer()

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let output = ''
  let toolCount = 0
  let hadActivity = false
  let lastEventText = ''
  let publishedArtifacts: StructuredSubagentArtifact[] = []
  const textState: SubagentStreamTextState = {
    inThink: false,
    inDcpId: false,
    pendingText: '',
  }

  const handleData = (data: string) => {
    const trimmed = data.trim()
    if (!trimmed || trimmed === '[DONE]') return
    const parsed = JSON.parse(trimmed) as Record<string, any>
    const delta = parsed?.choices?.[0]?.delta || {}
    if (typeof delta.content === 'string' && delta.content) {
      textState.pendingText += delta.content
      const visibleDelta = flushSubagentVisibleText(textState, false)
      if (visibleDelta) {
        output += visibleDelta
        if (args.emitVisibleOutput !== false) {
          args.emit('message.delta', {
            event: 'message.delta',
            run_id: args.runId,
            delta: visibleDelta,
          })
        }
      }
    }
    const piEvent = delta.pi_mono_event as Record<string, unknown> | undefined
    if (piEvent && typeof piEvent.kind === 'string') {
      hadActivity = true
      const eventKind = String(piEvent.kind)
      const eventText = [
        sanitizeSubagentDisplayText(String(piEvent.message || '').trim()),
        piEvent.result != null ? previewText(piEvent.result, 220) : '',
      ].filter(Boolean).join(' - ')
      if (eventText) lastEventText = eventText
      if (eventKind === 'error') {
        throw new Error(sanitizeSubagentDisplayText(String(piEvent.message || 'sub-agent runtime error').trim()) || 'sub-agent runtime error')
      }
      const mapped = mapPiMonoEvent({
        kind: eventKind,
        event: piEvent,
        runId: args.runId,
        taskId: args.taskId,
        subagentId: args.agentId,
        agentName: args.agentName,
        goal: args.goal,
        toolCount,
      })
      if (mapped) {
        toolCount = mapped.nextToolCount
        if (mapped.event === 'subagent.tool') {
          publishedArtifacts = mergeStructuredArtifacts(
            publishedArtifacts,
            extractArtifactsFromRuntimePayload((mapped.payload as Record<string, unknown>).result),
          )
        }
        args.emit(mapped.event, mapped.payload)
      }
    }
  }

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (error) {
        clearIdleTimer()
        if (idleTimedOut) {
          throw new Error(`sub-agent stream idle timeout after ${Math.round(idleTimeoutMs / 1000)}s`)
        }
        throw error
      }
      resetIdleTimer()
      const { done, value } = chunk
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let delimiterIndex = buffer.indexOf('\n\n')
      while (delimiterIndex >= 0) {
        const block = buffer.slice(0, delimiterIndex)
        buffer = buffer.slice(delimiterIndex + 2)
        const lines = block.split(/\r?\n/)
        const dataLines: string[] = []
        for (const line of lines) {
          if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
        }
        if (dataLines.length > 0) handleData(dataLines.join('\n'))
        delimiterIndex = buffer.indexOf('\n\n')
      }
    }

    if (buffer.trim()) {
      const lines = buffer.split(/\r?\n/)
      const dataLines = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart())
      if (dataLines.length > 0) handleData(dataLines.join('\n'))
    }

    const trailingVisible = flushSubagentVisibleText(textState, true)
    if (trailingVisible) {
      output += trailingVisible
      if (args.emitVisibleOutput !== false) {
        args.emit('message.delta', {
          event: 'message.delta',
          run_id: args.runId,
          delta: trailingVisible,
        })
      }
    }
  } finally {
    clearIdleTimer()
  }

  return {
    output: sanitizeSubagentDisplayText(output),
    toolCount,
    hadActivity,
    lastEventText: sanitizeSubagentDisplayText(lastEventText),
    artifacts: publishedArtifacts,
  }
}

export async function handleSubagentRun(
  nsp: ReturnType<Server['of']>,
  socket: Socket,
  data: SubagentRunSocketData,
  profile: string,
  sessionMap: Map<string, SessionState>,
  decision: MultiAgentRouteDecision,
  dequeueNextQueuedRun?: (socket: Socket, sessionId: string, fallbackProfile?: string) => boolean,
  skipUserMessage = false,
  options: SubagentContinuationOptions = {},
): Promise<void> {
  const sessionId = String(data.session_id || '').trim()
  if (!sessionId) {
    socket.emit('run.failed', { event: 'run.failed', error: 'session_id is required for multi-agent sub-agent runs' })
    return
  }
  if (!decision.selectedAgent?.baseUrl) {
    socket.emit('run.failed', {
      event: 'run.failed',
      session_id: sessionId,
      error: 'selected sub-agent is missing baseUrl',
    })
    return
  }

  const runId = `subagent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const nowSeconds = Math.floor(Date.now() / 1000)
  const input = data.input
  const displayInput = data.display_input === undefined ? input : data.display_input
  const displayRole = data.display_role === 'command' ? 'command' : 'user'
  const displayText = displayInput == null ? '' : contentBlocksToString(displayInput)
  const storageInputStr = data.storage_message !== undefined ? data.storage_message : displayText
  const preview = extractTextForPreview(displayInput === null ? input : displayInput).trim() || decision.summary || '多智能体任务'
  const latestUserInputText = extractTextForPreview(displayInput === null ? input : displayInput).trim()
    || contentBlocksToString(displayInput === null ? input : displayInput).trim()
  const runSource = data.session_source === 'global_agent' || data.source === 'global_agent'
    ? 'global_agent'
    : data.session_source === 'workflow' || data.source === 'workflow'
      ? 'workflow'
      : 'cli'
  const state = getOrCreateSession(sessionMap, sessionId)
  let handedOffToDiTing = false
  let failureFeedbackSent = false
  state.isWorking = true
  state.isAborting = false
  state.profile = profile
  state.source = runSource
  state.events = []
  state.runId = runId
  state.activeRunMarker = runId
  state.abortController = undefined
  state.responseRun = undefined

  const existingSession = getSession(sessionId)
  const socketUser = socket.data.user as { id?: string | number } | undefined
  if (!existingSession) {
    createSession({
      id: sessionId,
      profile,
      source: runSource,
      user_id: effectiveSessionOwnerId(socketUser, requestedUserContextFromSocket(socket)),
      title: preview,
      workspace: data.workspace || undefined,
    })
  }

  const emit = (event: string, payload: any) => {
    const tagged = {
      ...payload,
      session_id: sessionId,
      ...(data.collaboration_run_id ? { collaboration_run_id: data.collaboration_run_id } : {}),
    }
    pushState(sessionMap, sessionId, event, tagged)
    data.onEvent?.(event, tagged)
    nsp.to(`session:${sessionId}`).emit(event, tagged)
    if (!data.onEvent && !nsp.adapter.rooms.get(`session:${sessionId}`)?.size && socket.connected) {
      socket.emit(event, tagged)
    }
  }

  if (!skipUserMessage && displayInput !== null) {
    const messageId = addMessage({
      session_id: sessionId,
      role: displayRole,
      content: storageInputStr,
      timestamp: nowSeconds,
    })
    state.messages.push({
      id: messageId || state.messages.length + 1,
      session_id: sessionId,
      role: displayRole,
      content: storageInputStr,
      timestamp: nowSeconds,
    })
  }

  emit('run.started', {
    event: 'run.started',
    run_id: runId,
  })
  let currentDecision = decision
  const resumedPendingTask = data.resume_pending_subagent_task || null
  let lastStartedAt = Date.now()
  try {
    while (true) {
      const selectedAgent = currentDecision.selectedAgent
      if (!selectedAgent?.baseUrl) throw new Error('selected sub-agent is missing baseUrl')
      const currentNodeIds = activeDelegatedNodeIds(currentDecision)
      if (currentNodeIds.length === 0) {
        throw new Error('no executable delegated node remains; downstream nodes are blocked or waiting for replan')
      }
      const blockedDownstreamNodeIds = collectDependentPlanNodeIds(currentDecision, currentNodeIds)
      const activeResumeTask = resumedPendingTask && currentNodeIds.includes(resumedPendingTask.node_id)
        ? resumedPendingTask
        : null
      const currentTaskId = activeResumeTask?.task_id || randomUUID()
      const currentGoal = subagentGoal(currentDecision)
      const currentNodeTitle = resolveDelegatedNodeTitle(currentDecision, currentNodeIds)
      const emitAssistantFeedbackMessage = (content: string) => {
        const normalizedContent = sanitizeSubagentDisplayText(content).trim()
        if (!normalizedContent) return null
        const timestamp = Math.floor(Date.now() / 1000)
        const messageId = addMessage({
          session_id: sessionId,
          role: 'assistant',
          content: normalizedContent,
          timestamp,
          finish_reason: 'stop',
        })
        const normalizedMessageId = String(messageId || state.messages.length + 1)
        state.messages.push({
          id: messageId || state.messages.length + 1,
          session_id: sessionId,
          role: 'assistant',
          content: normalizedContent,
          timestamp,
          finish_reason: 'stop',
        })
        updateSessionStats(sessionId)
        emit('assistant.message', {
          event: 'assistant.message',
          run_id: runId,
          message_id: normalizedMessageId,
          content: normalizedContent,
          timestamp: Math.floor(Date.now()),
        })
        return normalizedContent
      }
      const emitFailureFeedbackMessage = (reason: string, recoverable: boolean) => {
        if (failureFeedbackSent) return null
        const feedback = buildDelegatedFailureFeedback({
          decision: currentDecision,
          nodeIds: currentNodeIds,
          agentName: selectedAgent.name,
          reason,
          recoverable,
          blockedNodeIds: blockedDownstreamNodeIds,
        })
        const emittedContent = emitAssistantFeedbackMessage(feedback)
        if (emittedContent) failureFeedbackSent = true
        return emittedContent
      }
      lastStartedAt = Date.now()
      emit('subagent.task_sent', {
        event: 'subagent.task_sent',
        run_id: runId,
        task_id: currentTaskId,
        subagent_id: selectedAgent.id,
        agent_name: selectedAgent.name,
        plan_node_ids: currentNodeIds,
        task_index: 0,
        task_count: 1,
        goal: currentGoal,
        node_title: currentNodeTitle,
        summary: currentGoal,
        text: `主智能体已向${selectedAgent.name}下发“${currentNodeTitle}”节点任务。`,
      })
      emit('subagent.start', {
        event: 'subagent.start',
        run_id: runId,
        task_id: currentTaskId,
        subagent_id: selectedAgent.id,
        agent_name: selectedAgent.name,
        plan_node_ids: currentNodeIds,
        task_index: 0,
        task_count: 1,
        goal: currentGoal,
        model: 'pi-mono',
      })
      emit('subagent.task_accepted', {
        event: 'subagent.task_accepted',
        run_id: runId,
        task_id: currentTaskId,
        subagent_id: selectedAgent.id,
        agent_name: selectedAgent.name,
        plan_node_ids: currentNodeIds,
        task_index: 0,
        task_count: 1,
        goal: currentGoal,
        node_title: currentNodeTitle,
        text: `${selectedAgent.name} 已接单，开始执行当前节点。`,
      })

      const url = normalizeChatUrl(selectedAgent.baseUrl, selectedAgent.chatPath)
      const streamResult = await streamSubagentCompletion({
        url,
        sessionId,
        agentId: selectedAgent.id,
        taskId: currentTaskId,
        nodeId: currentNodeIds[0] || '',
        agentName: selectedAgent.name,
        messages: buildSubagentMessages(currentDecision, {
          sessionId,
          taskId: currentTaskId,
          latestUserInput: activeResumeTask ? latestUserInputText : '',
          resumeTask: activeResumeTask,
        }),
        emit,
        runId,
        goal: currentGoal,
        recentContext: currentDecision.conversationContext || '',
        clarificationContext: activeResumeTask
          ? {
              question: activeResumeTask.question,
              required_fields: activeResumeTask.required_fields,
              previous_visible_output: activeResumeTask.last_visible_output,
              previous_summary: activeResumeTask.last_result_summary,
              user_follow_up: latestUserInputText,
            }
          : null,
        emitVisibleOutput: false,
      })
      const nodeResult = resolveSubagentAssistantContent({
        output: streamResult.output,
        agentName: selectedAgent.name,
        goal: currentGoal,
        toolCount: streamResult.toolCount,
        hadActivity: streamResult.hadActivity,
        lastEventText: streamResult.lastEventText,
        artifacts: streamResult.artifacts,
      })
      const structuredOutputSummary = previewStructuredObject(nodeResult.structuredOutput, 280)
      const artifactSummary = nodeResult.artifacts.length > 0
        ? `已交付文件：${nodeResult.artifacts.slice(0, 3).map(item => item.filename).join('、')}${nodeResult.artifacts.length > 3 ? ' 等' : ''}。`
        : ''
      const assistantContent = nodeResult.assistantContent || nodeResult.visibleOutput || nodeResult.summary || structuredOutputSummary || artifactSummary
      const assistantMessageContent = buildSubagentAssistantMessageContent({
        assistantContent,
        artifacts: nodeResult.artifacts,
        baseUrl: selectedAgent.baseUrl,
      })
      const groundingObservation = buildSubagentGroundingObservation(nodeResult)
      const completionSummary = nodeResult.summary || assistantContent || artifactSummary || structuredOutputSummary
      if (!assistantContent && nodeResult.artifacts.length === 0 && !hasStructuredPayload(nodeResult.structuredOutput)) {
        throw new Error('sub-agent returned no visible output')
      }
      const persistAssistantMessage = () => {
        const timestamp = Math.floor(Date.now() / 1000)
        const assistantMessageId = addMessage({
          session_id: sessionId,
          role: 'assistant',
          content: assistantMessageContent,
          timestamp,
          finish_reason: 'stop',
        })
        state.messages.push({
          id: assistantMessageId || state.messages.length + 1,
          session_id: sessionId,
          role: 'assistant',
          content: assistantMessageContent,
          timestamp,
          finish_reason: 'stop',
        })
      }

      if (nodeResult.status === 'clarify_required') {
        const clarification = nodeResult.clarification || {
          question: assistantContent || nodeResult.visibleOutput || completionSummary,
          reason: '',
          requiredFields: [],
          acceptableAnyOf: true,
        }
        const pendingTask = upsertPendingSubagentTask({
          session_id: sessionId,
          task_id: currentTaskId,
          collaboration_run_id: data.collaboration_run_id || null,
          profile,
          node_id: currentNodeIds[0] || '',
          agent_id: selectedAgent.id,
          agent_name: selectedAgent.name,
          objective: currentGoal || currentDecision.inputText,
          question: clarification.question || assistantContent,
          required_fields: clarification.requiredFields,
          clarification: {
            question: clarification.question,
            reason: clarification.reason,
            required_fields: clarification.requiredFields,
            acceptable_any_of: clarification.acceptableAnyOf,
          },
          route_decision_json: currentDecision as unknown as Record<string, unknown>,
          result_json: nodeResult.raw || {
            status: nodeResult.status,
            completed: false,
            grounding_status: nodeResult.groundingStatus,
            output_completeness: nodeResult.outputCompleteness,
            finalizable: nodeResult.finalizable,
            summary: nodeResult.summary,
            visible_output: nodeResult.visibleOutput,
            structured_output: nodeResult.structuredOutput,
            blockers: nodeResult.blockers,
            evidence: nodeResult.evidence,
          },
          last_result_summary: completionSummary,
          last_visible_output: assistantContent || nodeResult.visibleOutput,
        })
        emit('subagent.clarify_required', {
          event: 'subagent.clarify_required',
          run_id: runId,
          task_id: currentTaskId,
          subagent_id: selectedAgent.id,
          agent_name: selectedAgent.name,
          plan_node_ids: currentNodeIds,
          task_index: 0,
          task_count: 1,
          goal: currentGoal,
          status: 'clarify_required',
          node_completed: false,
          node_status: 'clarify_required',
          question: pendingTask.question,
          reason: pendingTask.clarification.reason,
          required_fields: pendingTask.required_fields,
          acceptable_any_of: pendingTask.clarification.acceptable_any_of,
          blockers: nodeResult.blockers,
          evidence: nodeResult.evidence,
          grounding_status: nodeResult.groundingStatus,
          output_completeness: nodeResult.outputCompleteness,
          finalizable: nodeResult.finalizable,
          structured_output: nodeResult.structuredOutput,
          structured_result: nodeResult.raw,
          summary: completionSummary.slice(0, 240),
          output: assistantContent,
          duration_seconds: Math.round((Date.now() - lastStartedAt) / 100) / 10,
          api_calls: 1,
        })
        persistAssistantMessage()
        updateSessionStats(sessionId)
        const usage = await calcAndUpdateUsage(sessionId, state, emit)
        updateUsage(sessionId, {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          model: selectedAgent.name,
          profile,
        })
        emit('run.completed', {
          event: 'run.completed',
          run_id: runId,
          status: 'clarify_required',
          waiting_for_input: true,
          pending_subagent_task: {
            task_id: pendingTask.task_id,
            node_id: pendingTask.node_id,
            agent_id: pendingTask.agent_id,
            agent_name: pendingTask.agent_name,
            question: pendingTask.question,
            required_fields: pendingTask.required_fields,
          },
          output: assistantContent,
          parsed_content: assistantMessageContent,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        })
        return
      }
      deletePendingSubagentTask(sessionId)
      if (nodeResult.artifacts.length > 0) {
        emit('subagent.artifact_published', {
          event: 'subagent.artifact_published',
          run_id: runId,
          task_id: currentTaskId,
          subagent_id: selectedAgent.id,
          agent_name: selectedAgent.name,
          plan_node_ids: currentNodeIds,
          task_index: 0,
          task_count: 1,
          goal: currentGoal,
          node_title: currentNodeTitle,
          artifacts: nodeResult.artifacts,
          summary: artifactSummary || '节点结果已发布为 artifact。',
          text: artifactSummary || '节点结果已发布为 artifact。',
        })
      }
      emit('subagent.result_received', {
        event: 'subagent.result_received',
        run_id: runId,
        task_id: currentTaskId,
        subagent_id: selectedAgent.id,
        agent_name: selectedAgent.name,
        plan_node_ids: currentNodeIds,
        task_index: 0,
        task_count: 1,
        goal: currentGoal,
        node_title: currentNodeTitle,
        status: nodeResult.status,
        node_completed: nodeResult.completed,
        node_status: nodeResult.status,
        grounding_status: nodeResult.groundingStatus,
        output_completeness: nodeResult.outputCompleteness,
        finalizable: nodeResult.finalizable,
        blockers: nodeResult.blockers,
        evidence: nodeResult.evidence,
        artifacts: nodeResult.artifacts,
        structured_output: nodeResult.structuredOutput,
        structured_result: nodeResult.raw,
        summary: completionSummary.slice(0, 240),
        text: groundingObservation,
      })
      emit('subagent.complete', {
        event: 'subagent.complete',
        run_id: runId,
        task_id: currentTaskId,
        subagent_id: selectedAgent.id,
        agent_name: selectedAgent.name,
        plan_node_ids: currentNodeIds,
        task_index: 0,
        task_count: 1,
        goal: currentGoal,
        status: nodeResult.completed ? 'completed' : nodeResult.status,
        node_completed: nodeResult.completed,
        node_status: nodeResult.status,
        grounding_status: nodeResult.groundingStatus,
        output_completeness: nodeResult.outputCompleteness,
        finalizable: nodeResult.finalizable,
        blockers: nodeResult.blockers,
        evidence: nodeResult.evidence,
        artifacts: nodeResult.artifacts,
        structured_output: nodeResult.structuredOutput,
        structured_result: nodeResult.raw,
        summary: completionSummary.slice(0, 240),
        output: assistantContent,
        duration_seconds: Math.round((Date.now() - lastStartedAt) / 100) / 10,
        api_calls: 1,
        ...(nodeResult.completed ? {} : buildBlockedPlanNodePayload(
          currentDecision,
          blockedDownstreamNodeIds,
          nodeResult.blockers[0] || nodeResult.guardReason || nodeResult.summary || '当前节点未完成',
        )),
      })

      if (!nodeResult.completed) {
        const failureReason = nodeResult.blockers[0]
          || nodeResult.guardReason
          || nodeResult.summary
          || nodeResult.visibleOutput
          || assistantContent
          || completionSummary
        const blockedByGrounding = nodeResult.groundingStatus === 'partial'
          || nodeResult.groundingStatus === 'truncated'
          || nodeResult.groundingStatus === 'unverified'
          || nodeResult.groundingStatus === 'unsafe_to_finalize'
          || nodeResult.outputCompleteness === 'partial'
          || nodeResult.outputCompleteness === 'truncated'
          || nodeResult.finalizable === false
        const shouldEmitGroundingBlock = blockedByGrounding
          && nodeResult.status !== 'failed'
          && nodeResult.status !== 'blocked'
        if (shouldEmitGroundingBlock) {
          emit('subagent.result_rejected', {
            event: 'subagent.result_rejected',
            run_id: runId,
            task_id: currentTaskId,
            subagent_id: selectedAgent.id,
            agent_name: selectedAgent.name,
            plan_node_ids: currentNodeIds,
            task_index: 0,
            task_count: 1,
            goal: currentGoal,
            node_title: currentNodeTitle,
            status: nodeResult.status,
            node_completed: false,
            node_status: nodeResult.status,
            grounding_status: nodeResult.groundingStatus,
            output_completeness: nodeResult.outputCompleteness,
            finalizable: false,
            blockers: nodeResult.blockers,
            evidence: nodeResult.evidence,
            artifacts: nodeResult.artifacts,
            structured_output: nodeResult.structuredOutput,
            structured_result: nodeResult.raw,
            summary: failureReason.slice(0, 240),
            text: groundingObservation,
            ...buildBlockedPlanNodePayload(currentDecision, blockedDownstreamNodeIds, failureReason),
          })
          emit('subagent.finalization_blocked', {
            event: 'subagent.finalization_blocked',
            run_id: runId,
            task_id: currentTaskId,
            subagent_id: selectedAgent.id,
            agent_name: selectedAgent.name,
            plan_node_ids: currentNodeIds,
            task_index: 0,
            task_count: 1,
            goal: currentGoal,
            node_title: currentNodeTitle,
            reason: failureReason,
            text: groundingObservation,
            ...buildBlockedPlanNodePayload(currentDecision, blockedDownstreamNodeIds, failureReason),
          })
          const blockedFeedback = emitAssistantFeedbackMessage(buildFinalizationBlockedFeedback({
            decision: currentDecision,
            agentName: selectedAgent.name,
            reason: failureReason,
            blockedNodeIds: blockedDownstreamNodeIds,
          }))
          if (blockedFeedback) failureFeedbackSent = true
        }
        emitFailureFeedbackMessage(failureReason, Boolean(options.continueWithDiTing))
        if (options.continueWithDiTing) {
          try {
            await options.continueWithDiTing({
              input: buildIncompleteNodeRecoveryInput({
                decision: currentDecision,
                currentNodeIds,
                result: nodeResult,
                blockedNodeIds: blockedDownstreamNodeIds,
              }),
              instructions: buildIncompleteNodeRecoveryInstructions(currentDecision, nodeResult, blockedDownstreamNodeIds),
              collaborationRunId: randomUUID(),
              objective: currentDecision.inputText,
            })
            handedOffToDiTing = true
            return
          } catch (error) {
            const continuationMessage = sanitizeSubagentDisplayText(error instanceof Error ? error.message : String(error))
            emit('run.failed', {
              event: 'run.failed',
              run_id: runId,
              assistant_feedback_sent: failureFeedbackSent,
              error: `sub-agent ${selectedAgent.name} did not complete current node: ${completionSummary}; recovery failed: ${continuationMessage}`,
            })
            return
          }
        }
        emit('run.failed', {
          event: 'run.failed',
          run_id: runId,
          assistant_feedback_sent: failureFeedbackSent,
          error: `sub-agent ${selectedAgent.name} did not complete current node: ${completionSummary}`,
        })
        return
      }

      const continuedDecision = buildDelegatedContinuationDecision(
        currentDecision,
        currentNodeIds,
        completionSummary,
      )
      const replan = continuedDecision
        ? null
        : await resolveMultiAgentReplan({
            profile,
            provider: data.provider,
            model: data.model,
            candidates: data.sub_agent_candidates || [],
            previous: currentDecision,
            observation: groundingObservation,
            onProgress: (event) => {
              emit('agent.event', {
                event: 'agent.event',
                kind: 'multi_agent_progress',
                ...event,
              })
            },
            onReasoning: (event) => {
              emit('agent.event', {
                event: 'agent.event',
                kind: 'multi_agent_reasoning',
                ...event,
              })
            },
          })
      const shouldHandoffToDiTing = Boolean(
        replan?.continueExecution
        && replan.routeDecision
        && replan.followUpInput
        && replan.routeDecision.DiTingInstructions
        && options.continueWithDiTing,
      )
      if (!continuedDecision && !shouldHandoffToDiTing) {
        persistAssistantMessage()
      }

      updateSessionStats(sessionId)
      const usage = await calcAndUpdateUsage(sessionId, state, emit)
      updateUsage(sessionId, {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        model: selectedAgent.name,
        profile,
      })

      if (continuedDecision) {
        currentDecision = continuedDecision
        continue
      }
      if (shouldHandoffToDiTing && replan?.routeDecision && replan.followUpInput && replan.routeDecision.DiTingInstructions) {
        const continueWithDiTing = options.continueWithDiTing
        if (!continueWithDiTing) throw new Error('main-agent continuation is unavailable')
        emit('agent.event', {
          event: 'agent.event',
          kind: 'multi_agent_route',
          mode: replan.routeDecision.executionMode,
          intent: replan.routeDecision.intent,
          category: replan.routeDecision.category,
          confidence: replan.routeDecision.confidence,
          reason: replan.routeDecision.reason,
          todo: replan.routeDecision.todo,
          constraints: replan.routeDecision.constraints,
          plan: replan.routeDecision.plan,
          selected_agent: replan.routeDecision.selectedAgent
            ? {
                id: replan.routeDecision.selectedAgent.id,
                name: replan.routeDecision.selectedAgent.name,
                baseUrl: replan.routeDecision.selectedAgent.baseUrl || '',
              }
            : null,
          text: replan.routeDecision.routeText,
        })
        try {
          await continueWithDiTing({
            input: replan.followUpInput,
            instructions: replan.routeDecision.DiTingInstructions,
          })
          handedOffToDiTing = true
          return
        } catch (error) {
          const message = sanitizeSubagentDisplayText(error instanceof Error ? error.message : String(error))
          emit('run.failed', {
            event: 'run.failed',
            run_id: runId,
            error: `main-agent continuation failed: ${message}`,
          })
          return
        }
      }

      emit('run.completed', {
        event: 'run.completed',
        run_id: runId,
        output: assistantContent,
        parsed_content: assistantMessageContent,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      })
      return
    }
  } catch (error) {
    const selectedAgent = currentDecision.selectedAgent
    const failedNodeIds = activeDelegatedNodeIds(currentDecision)
    const selectedAgentId = selectedAgent?.id || ''
    const selectedAgentName = selectedAgent?.name || '子智能体'
    const message = sanitizeSubagentDisplayText(error instanceof Error ? error.message : String(error))
    logger.warn('[chat-run-socket] delegated sub-agent run failed for session %s agent=%s: %s', sessionId, selectedAgentId, message)
    emit('subagent.complete', {
      event: 'subagent.complete',
      run_id: runId,
      subagent_id: selectedAgentId,
      agent_name: selectedAgentName,
      plan_node_ids: failedNodeIds,
      task_index: 0,
      task_count: 1,
      goal: subagentGoal(currentDecision),
      status: 'failed',
      summary: message,
      duration_seconds: Math.round((Date.now() - lastStartedAt) / 100) / 10,
      ...buildBlockedPlanNodePayload(currentDecision, collectDependentPlanNodeIds(currentDecision, failedNodeIds), message),
    })
    if (!failureFeedbackSent) {
      const blockedDownstreamNodeIds = collectDependentPlanNodeIds(currentDecision, failedNodeIds)
      const feedback = buildDelegatedFailureFeedback({
        decision: currentDecision,
        nodeIds: failedNodeIds,
        agentName: selectedAgentName,
        reason: message,
        recoverable: Boolean(options.continueWithDiTing),
        blockedNodeIds: blockedDownstreamNodeIds,
      })
      const timestamp = Math.floor(Date.now() / 1000)
      const messageId = addMessage({
        session_id: sessionId,
        role: 'assistant',
        content: feedback,
        timestamp,
        finish_reason: 'stop',
      })
      state.messages.push({
        id: messageId || state.messages.length + 1,
        session_id: sessionId,
        role: 'assistant',
        content: feedback,
        timestamp,
        finish_reason: 'stop',
      })
      updateSessionStats(sessionId)
      emit('assistant.message', {
        event: 'assistant.message',
        run_id: runId,
        message_id: String(messageId || state.messages.length),
        content: feedback,
        timestamp: Math.floor(Date.now()),
      })
      failureFeedbackSent = true
    }
    if (options.continueWithDiTing) {
      try {
        const blockedDownstreamNodeIds = collectDependentPlanNodeIds(currentDecision, failedNodeIds)
        await options.continueWithDiTing({
          input: buildFailureRecoveryInput({
            decision: currentDecision,
            failedNodeIds,
            failure: message,
            blockedNodeIds: blockedDownstreamNodeIds,
          }),
          instructions: buildFailureRecoveryInstructions(currentDecision, message, blockedDownstreamNodeIds),
          collaborationRunId: randomUUID(),
          objective: currentDecision.inputText,
        })
        handedOffToDiTing = true
        return
      } catch (continuationError) {
        const continuationMessage = sanitizeSubagentDisplayText(
          continuationError instanceof Error ? continuationError.message : String(continuationError),
        )
        emit('run.failed', {
          event: 'run.failed',
          run_id: runId,
          assistant_feedback_sent: failureFeedbackSent,
          error: `sub-agent ${selectedAgentName} failed: ${message}; replanning failed: ${continuationMessage}`,
        })
        return
      }
    }
    emit('run.failed', {
      event: 'run.failed',
      run_id: runId,
      assistant_feedback_sent: failureFeedbackSent,
      error: `sub-agent ${selectedAgentName} failed: ${message}`,
    })
  } finally {
    if (handedOffToDiTing) return
    state.isWorking = false
    state.isAborting = false
    state.runId = undefined
    state.activeRunMarker = undefined
    state.responseRun = undefined
    state.events = []
    state.profile = state.queue.length > 0 ? (state.queue[0]?.profile || profile) : undefined
    state.source = state.queue.length > 0 ? state.queue[0]?.source : state.source
    if (state.queue.length > 0 && !state.activeRunMarker && dequeueNextQueuedRun) {
      dequeueNextQueuedRun(socket, sessionId, profile)
    }
  }
}
