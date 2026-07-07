import { randomUUID } from 'crypto'
import type { Server, Socket } from 'socket.io'
import { addMessage, createSession, getSession, updateSessionStats } from '../../../db/hermes/session-store'
import { updateUsage } from '../../../db/hermes/usage-store'
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
  onEvent?: (event: string, payload: any) => void
}

interface SubagentContinuationOptions {
  continueWithHermes?: (args: {
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
    'hermes',
    sanitizeSubagentSessionIdPart(sessionId),
    sanitizeSubagentSessionIdPart(agentId),
  ].filter(Boolean)
  const joined = parts.join('-').slice(0, 120)
  const normalized = joined.replace(/[^A-Za-z0-9]+$/, '')
  return normalized || 'hermes-subagent'
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
  return sanitizeSubagentDisplayText(text)
    .replace(/^(?:#{1,6}\s*)?节点\s*\d+\s*执行结果[^\n]*\n+/gim, '')
    .replace(/^(?:#{1,6}\s*)?阶段\s*[一二三四五六七八九十0-9]+\s*(?:执行结果|阶段成果)[^\n]*\n+/gim, '')
    .replace(/^(?:#{1,6}\s*)?当前节点(?:执行)?结果[^\n]*\n+/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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
}

type StructuredSubagentNodeStatus = 'completed' | 'blocked' | 'failed' | 'partial'

interface StructuredSubagentArtifact {
  artifactId?: string
  filename: string
  downloadUrl?: string
  downloadPath?: string
  workspacePath?: string
  contentType?: string
  size?: number
}

interface StructuredSubagentNodeResult {
  status: StructuredSubagentNodeStatus
  completed: boolean
  summary: string
  visibleOutput: string
  blockers: string[]
  evidence: string[]
  artifacts: StructuredSubagentArtifact[]
  raw: Record<string, unknown> | null
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
  if (normalized === 'completed' || normalized === 'blocked' || normalized === 'failed' || normalized === 'partial') {
    return normalized
  }
  return 'completed'
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

function parseStructuredSubagentNodeResult(output: string): StructuredSubagentNodeResult | null {
  const jsonText = extractJsonObjectText(output)
  if (!jsonText) return null
  try {
    const raw = JSON.parse(jsonText) as Record<string, unknown>
    const status = normalizeStructuredNodeStatus(raw.status)
    const completed = raw.completed === true || status === 'completed'
    return {
      status,
      completed,
      summary: sanitizeSubagentDisplayText(String(raw.summary ?? '')).trim(),
      visibleOutput: sanitizeSubagentDisplayText(String(raw.visible_output ?? raw.visibleOutput ?? '')).trim(),
      blockers: stringArray(raw.blockers),
      evidence: stringArray(raw.evidence),
      artifacts: [
        ...structuredArtifacts(raw.artifacts),
        ...structuredArtifacts(raw.artifact),
      ],
      raw,
    }
  } catch {
    return null
  }
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

export function resolveSubagentAssistantContent(args: {
  output: string
  agentName: string
  goal: string
  toolCount: number
  hadActivity: boolean
  lastEventText: string
}): StructuredSubagentNodeResult & { assistantContent: string } {
  const structured = parseStructuredSubagentNodeResult(args.output)
  const direct = normalizeSubagentAssistantOutput(
    structured?.visibleOutput || structured?.summary || args.output,
  )
  const useStructuredFallback =
    !!direct
    && args.hadActivity
    && looksLikePrefatorySubagentText(direct)
  if (direct && !useStructuredFallback) {
    return {
      status: structured?.status || 'completed',
      completed: structured?.completed ?? true,
      summary: structured?.summary || direct,
      visibleOutput: structured?.visibleOutput || direct,
      blockers: structured?.blockers || [],
      evidence: structured?.evidence || [],
      artifacts: structured?.artifacts || [],
      raw: structured?.raw || null,
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
      artifacts: structured?.artifacts || [],
      raw: structured?.raw || null,
      assistantContent: '',
    }
  }

  const segments: string[] = []
  if (direct) segments.push(direct)
  if (structured?.completed === false) {
    segments.push(`子智能体「${args.agentName}」未完成当前节点。`)
    if (structured.blockers.length > 0) segments.push(`阻塞：${structured.blockers.join('；')}。`)
  } else {
    segments.push(`子智能体「${args.agentName}」已完成当前任务。`)
  }
  if (structured?.summary) {
    segments.push(`阶段结果：${structured.summary}。`)
  } else if (args.lastEventText) {
    segments.push(`阶段结果：${args.lastEventText}。`)
  } else if (args.toolCount > 0) {
    segments.push(`本次共执行 ${args.toolCount} 次工具调用。`)
  } else if (args.goal) {
    segments.push(`目标：${args.goal}。`)
  }
  const assistantContent = segments.join(' ')
  return {
    status: structured?.status || 'completed',
    completed: structured?.completed ?? true,
    summary: structured?.summary || direct || args.lastEventText || args.goal,
    visibleOutput: structured?.visibleOutput || direct || assistantContent,
    blockers: structured?.blockers || [],
    evidence: structured?.evidence || [],
    artifacts: structured?.artifacts || [],
    raw: structured?.raw || null,
    assistantContent,
  }
}

function resolveSubagentArtifactUrl(baseUrl: string, artifact: StructuredSubagentArtifact) {
  const direct = String(artifact.downloadUrl || '').trim()
  if (direct) return direct
  const relative = String(artifact.downloadPath || '').trim()
  if (!relative) return ''
  if (/^https?:\/\//i.test(relative)) return relative
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '')
  const normalizedPath = relative.startsWith('/') ? relative : `/${relative}`
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

function isDelegatedNodeReady(decision: MultiAgentRouteDecision, nodeId: string) {
  if (!decision.plan) return false
  const node = decision.plan.nodes.find(item => item.id === nodeId)
  if (!node || node.status === 'done' || node.status === 'blocked') return false
  const blockingDependencies = (decision.plan.dependencies || []).filter(dependency => dependency.to === node.id && dependency.type === 'blocks')
  return blockingDependencies.every((dependency) => {
    const dependencyNode = decision.plan?.nodes.find(item => item.id === dependency.from)
    return !dependencyNode || dependencyNode.status === 'done'
  })
}

function resolveActiveDelegatedPlanNodes(decision: MultiAgentRouteDecision) {
  const delegatedNodes = delegatedPlanNodes(decision)
  if (delegatedNodes.length === 0) return []
  const readyNode = delegatedNodes.find(node => isDelegatedNodeReady(decision, node.id))
  return readyNode ? [readyNode] : [delegatedNodes[0]!]
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

function buildSubagentMessages(decision: MultiAgentRouteDecision) {
  const delegatedPlanNodes = resolveActiveDelegatedPlanNodes(decision)
  const currentNode = delegatedPlanNodes[0] || null
  const currentNodeDependsOn = currentNode
    ? (decision.plan?.dependencies || [])
        .filter(dependency => dependency.to === currentNode.id)
        .map(dependency => dependency.from)
    : []
  const system = [
    '你是被 Hermes Studio 选中的子智能体执行者。',
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
    '如果数据为空、权限不足、工具失败或条件不足，直接返回未完成状态和阻塞原因。',
    '如果当前节点产出的是可下载文件或需要向主智能体交付文件，先把文件 publish 为 artifact，再把 artifact 元数据放进 artifacts。',
    '必须只返回一个 JSON 对象，不要输出 Markdown、解释文字或代码块。',
    'JSON schema: {"status":"completed|blocked|failed|partial","completed":boolean,"summary":"string","visible_output":"string","blockers":["string"],"evidence":["string"],"artifacts":[{"artifact_id":"string","filename":"string","download_url":"string","download_path":"string","workspace_path":"string","content_type":"string","size":0}]}',
    '其中 completed=true 仅表示“当前节点任务已完成”，不是整轮任务已完成。',
    'visible_output 是给用户看的阶段成果正文；summary 是给主智能体的简要摘要；blockers 写未完成原因；evidence 写关键依据或结果点。',
    'artifacts 是可选字段；只有当当前节点真的产出了交付文件时才返回。',
  ].join('\n')
  const scopedUserPrompt = currentNode
    ? JSON.stringify({
        protocol: 'hermes_node_task_v1',
        original_user_request: decision.inputText,
        recent_session_context: decision.conversationContext || '',
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
          '若阻塞，completed=false，status=blocked 或 failed，并填写 blockers。',
        ],
        return_schema: {
          status: 'completed|blocked|failed|partial',
          completed: true,
          summary: '主智能体阅读摘要',
          visible_output: '给用户看的阶段成果',
          blockers: ['未完成原因'],
          evidence: ['关键依据或结果点'],
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
) {
  const base = decision.hermesInstructions ? `${decision.hermesInstructions}\n\n` : ''
  return [
    base.trim(),
    '当前多智能体协作中的子智能体已返回，但没有完成当前节点任务。',
    '处理要求：',
    '- 不要把该节点标记为成功。',
    '- 先吸收 blockers / evidence，再决定是向用户补充澄清、重新规划，还是改由主智能体接管。',
    '- 如果当前节点缺少必要条件，请直接向用户说明阻塞项。',
    `节点状态：${result.status}`,
    result.summary ? `节点摘要：${result.summary}` : '',
    result.blockers.length > 0 ? `阻塞原因：${result.blockers.join('；')}` : '',
  ].filter(Boolean).join('\n')
}

function buildIncompleteNodeRecoveryInput(args: {
  decision: MultiAgentRouteDecision
  currentNodeIds: string[]
  result: StructuredSubagentNodeResult
}) {
  const currentNodes = formatDelegatedNodeList(args.decision, args.currentNodeIds)
  return [
    `原始用户需求：${args.decision.inputText}`,
    currentNodes ? `未完成节点：\n${currentNodes}` : '',
    `节点状态：${args.result.status}`,
    args.result.summary ? `节点摘要：${args.result.summary}` : '',
    args.result.visibleOutput ? `阶段输出：${args.result.visibleOutput}` : '',
    args.result.blockers.length > 0 ? `阻塞原因：${args.result.blockers.join('；')}` : '',
    '请基于当前未完成节点重新判断下一步，不要沿用“该节点已完成”的假设。',
  ].filter(Boolean).join('\n\n')
}

function formatDelegatedNodeList(decision: MultiAgentRouteDecision, nodeIds: string[]) {
  const nodeIdSet = new Set(nodeIds)
  return (decision.plan?.nodes || [])
    .filter(node => nodeIdSet.has(node.id))
    .map((node, index) => `${index + 1}. [${node.phase}] ${node.title}${node.summary ? ` - ${node.summary}` : ''}`)
    .join('\n')
}

function buildFailureRecoveryInstructions(decision: MultiAgentRouteDecision, failure: string) {
  const base = decision.hermesInstructions ? `${decision.hermesInstructions}\n\n` : ''
  return [
    base.trim(),
    '当前多智能体执行中的子智能体节点已经失败。',
    '处理要求：',
    '- 立即终止上一版计划，不要继续沿用失败节点的执行状态。',
    '- 重新评估剩余工作，再决定是否生成新一版 Todo List 和执行节点。',
    '- 如果缺少必要条件或工具异常无法绕过，直接给用户说明阻塞原因和下一步所需条件。',
    '- 不要把失败节点标记为成功，也不要复用旧计划里的进行中节点。',
    `失败摘要：${failure}`,
  ].filter(Boolean).join('\n')
}

function buildFailureRecoveryInput(args: {
  decision: MultiAgentRouteDecision
  failedNodeIds: string[]
  failure: string
}) {
  const failedNodes = formatDelegatedNodeList(args.decision, args.failedNodeIds)
  return [
    `原始用户需求：${args.decision.inputText}`,
    failedNodes ? `失败节点：\n${failedNodes}` : '',
    `失败原因：${args.failure}`,
    '请结束上一版失败计划，并基于当前信息重新判断后续是否还能继续执行。',
    '如果可以继续，请先重新生成新的协作计划；如果不能继续，请直接说明阻塞项。',
  ].filter(Boolean).join('\n\n')
}

function mapPiMonoEvent(args: {
  kind: string
  event: Record<string, unknown>
  runId: string
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
  messages: Array<{ role: string; content: string }>
  emit: (event: string, payload: any) => void
  runId: string
  agentName: string
  goal: string
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
        session_id: subagentSessionId,
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
        subagentId: args.agentId,
        agentName: args.agentName,
        goal: args.goal,
        toolCount,
      })
      if (mapped) {
        toolCount = mapped.nextToolCount
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
  const runSource = data.session_source === 'global_agent' || data.source === 'global_agent'
    ? 'global_agent'
    : data.session_source === 'workflow' || data.source === 'workflow'
      ? 'workflow'
      : 'cli'
  const state = getOrCreateSession(sessionMap, sessionId)
  let handedOffToHermes = false
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
  let lastStartedAt = Date.now()
  try {
    while (true) {
      const selectedAgent = currentDecision.selectedAgent
      if (!selectedAgent?.baseUrl) throw new Error('selected sub-agent is missing baseUrl')
      const currentNodeIds = activeDelegatedNodeIds(currentDecision)
      const currentGoal = subagentGoal(currentDecision)
      lastStartedAt = Date.now()
      emit('subagent.start', {
        event: 'subagent.start',
        run_id: runId,
        subagent_id: selectedAgent.id,
        agent_name: selectedAgent.name,
        plan_node_ids: currentNodeIds,
        task_index: 0,
        task_count: 1,
        goal: currentGoal,
        model: 'pi-mono',
      })

      const url = normalizeChatUrl(selectedAgent.baseUrl, selectedAgent.chatPath)
      const streamResult = await streamSubagentCompletion({
        url,
        sessionId,
        agentId: selectedAgent.id,
        agentName: selectedAgent.name,
        messages: buildSubagentMessages(currentDecision),
        emit,
        runId,
        goal: currentGoal,
        emitVisibleOutput: false,
      })
      const nodeResult = resolveSubagentAssistantContent({
        output: streamResult.output,
        agentName: selectedAgent.name,
        goal: currentGoal,
        toolCount: streamResult.toolCount,
        hadActivity: streamResult.hadActivity,
        lastEventText: streamResult.lastEventText,
      })
      const assistantContent = nodeResult.assistantContent
      const assistantMessageContent = buildSubagentAssistantMessageContent({
        assistantContent,
        artifacts: nodeResult.artifacts,
        baseUrl: selectedAgent.baseUrl,
      })
      const artifactSummary = nodeResult.artifacts.length > 0
        ? `已交付文件：${nodeResult.artifacts.slice(0, 3).map(item => item.filename).join('、')}${nodeResult.artifacts.length > 3 ? ' 等' : ''}。`
        : ''
      const completionSummary = nodeResult.summary || assistantContent || artifactSummary
      if (!assistantContent && nodeResult.artifacts.length === 0) {
        throw new Error('sub-agent returned no visible output')
      }
      emit('subagent.complete', {
        event: 'subagent.complete',
        run_id: runId,
        subagent_id: selectedAgent.id,
        agent_name: selectedAgent.name,
        plan_node_ids: currentNodeIds,
        task_index: 0,
        task_count: 1,
        goal: currentGoal,
        status: nodeResult.completed ? 'completed' : nodeResult.status,
        node_completed: nodeResult.completed,
        node_status: nodeResult.status,
        blockers: nodeResult.blockers,
        evidence: nodeResult.evidence,
        artifacts: nodeResult.artifacts,
        structured_result: nodeResult.raw,
        summary: completionSummary.slice(0, 240),
        output: assistantContent,
        duration_seconds: Math.round((Date.now() - lastStartedAt) / 100) / 10,
        api_calls: 1,
      })

      if (!nodeResult.completed) {
        if (options.continueWithHermes) {
          await options.continueWithHermes({
            input: buildIncompleteNodeRecoveryInput({
              decision: currentDecision,
              currentNodeIds,
              result: nodeResult,
            }),
            instructions: buildIncompleteNodeRecoveryInstructions(currentDecision, nodeResult),
            collaborationRunId: randomUUID(),
            objective: currentDecision.inputText,
          })
          handedOffToHermes = true
          return
        }
        emit('run.failed', {
          event: 'run.failed',
          run_id: runId,
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
            observation: nodeResult.visibleOutput || assistantContent || artifactSummary,
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
      const shouldHandoffToHermes = Boolean(
        replan?.continueExecution
        && replan.routeDecision
        && replan.followUpInput
        && replan.routeDecision.hermesInstructions
        && options.continueWithHermes,
      )
      if (!continuedDecision && !shouldHandoffToHermes) {
        const assistantMessageId = addMessage({
          session_id: sessionId,
          role: 'assistant',
          content: assistantMessageContent,
          timestamp: Math.floor(Date.now() / 1000),
          finish_reason: 'stop',
        })
        state.messages.push({
          id: assistantMessageId || state.messages.length + 1,
          session_id: sessionId,
          role: 'assistant',
          content: assistantMessageContent,
          timestamp: Math.floor(Date.now() / 1000),
          finish_reason: 'stop',
        })
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
      if (shouldHandoffToHermes && replan?.routeDecision && replan.followUpInput && replan.routeDecision.hermesInstructions) {
        const continueWithHermes = options.continueWithHermes
        if (!continueWithHermes) throw new Error('main-agent continuation is unavailable')
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
          await continueWithHermes({
            input: replan.followUpInput,
            instructions: replan.routeDecision.hermesInstructions,
          })
          handedOffToHermes = true
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
    })
    if (options.continueWithHermes) {
      try {
        await options.continueWithHermes({
          input: buildFailureRecoveryInput({
            decision: currentDecision,
            failedNodeIds,
            failure: message,
          }),
          instructions: buildFailureRecoveryInstructions(currentDecision, message),
          collaborationRunId: randomUUID(),
          objective: currentDecision.inputText,
        })
        handedOffToHermes = true
        return
      } catch (continuationError) {
        const continuationMessage = sanitizeSubagentDisplayText(
          continuationError instanceof Error ? continuationError.message : String(continuationError),
        )
        emit('run.failed', {
          event: 'run.failed',
          run_id: runId,
          error: `sub-agent ${selectedAgentName} failed: ${message}; replanning failed: ${continuationMessage}`,
        })
        return
      }
    }
    emit('run.failed', {
      event: 'run.failed',
      run_id: runId,
      error: `sub-agent ${selectedAgentName} failed: ${message}`,
    })
  } finally {
    if (handedOffToHermes) return
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
