import type { Server, Socket } from 'socket.io'
import { addMessage, createSession, getSession, updateSessionStats } from '../../../db/hermes/session-store'
import { updateUsage } from '../../../db/hermes/usage-store'
import { logger } from '../../logger'
import { contentBlocksToString, extractTextForPreview } from './content-blocks'
import { getOrCreateSession, pushState } from './compression'
import { calcAndUpdateUsage } from './usage'
import type { ContentBlock, SessionState } from './types'
import type { MultiAgentRouteDecision } from './multi-agent-routing'

interface SubagentRunSocketData {
  input: string | ContentBlock[]
  display_input?: string | ContentBlock[] | null
  display_role?: 'user' | 'command'
  storage_message?: string
  session_id?: string
  workspace?: string | null
  source?: string
  session_source?: 'global_agent' | 'workflow'
  queue_id?: string
  onEvent?: (event: string, payload: any) => void
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

function sanitizeSubagentSessionIdPart(value: string) {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_.!-]+/g, '-')
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

function normalizeCompactText(value: string) {
  return value.replace(/\s+/g, '').trim()
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
}) {
  const direct = sanitizeSubagentDisplayText(args.output)
  const useStructuredFallback =
    !!direct
    && args.hadActivity
    && looksLikePrefatorySubagentText(direct)
  if (direct && !useStructuredFallback) return direct
  if (!args.hadActivity) return ''

  const segments: string[] = []
  if (direct) segments.push(direct)
  segments.push(`子智能体「${args.agentName}」已完成当前任务。`)
  if (args.lastEventText) {
    segments.push(`阶段结果：${args.lastEventText}。`)
  } else if (args.toolCount > 0) {
    segments.push(`本次共执行 ${args.toolCount} 次工具调用。`)
  } else if (args.goal) {
    segments.push(`目标：${args.goal}。`)
  }
  segments.push('详细过程见右侧协作面板。')
  return segments.join(' ')
}

function subagentGoal(decision: MultiAgentRouteDecision) {
  return decision.summary || decision.inputText || '执行用户请求'
}

function buildSubagentMessages(decision: MultiAgentRouteDecision) {
  const system = [
    '你是被 Hermes Studio 选中的子智能体执行者。',
    `任务分类：${decision.category}`,
    `路由原因：${decision.reason}`,
    ...(decision.plan && decision.delegatedNodeIds.length > 0
      ? [
          '本次下发的任务清单：',
          ...decision.plan.nodes
            .filter(node => decision.delegatedNodeIds.includes(node.id))
            .map((node, index) => `${index + 1}. [${node.phase}] ${node.title} - ${node.summary}`),
        ]
      : []),
    '直接完成用户请求，不要解释路由过程，不要引用 Hermes Studio 内部实现。',
  ].join('\n')
  return [
    { role: 'system', content: system },
    { role: 'user', content: decision.inputText },
  ]
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
        tool_name: name || 'tool',
        tool_count: nextToolCount,
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
}): Promise<SubagentStreamSummary> {
  const subagentSessionId = buildSubagentSessionId(args.sessionId, args.agentId)
  let response: Response
  try {
    response = await fetch(args.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Pi-Mono-Session-Id': subagentSessionId,
      },
      body: JSON.stringify({
        model: 'pi-mono',
        stream: true,
        timeout: 600,
        session_id: subagentSessionId,
        messages: args.messages,
      }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`fetch failed for ${args.url}: ${message}`)
  }

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `sub-agent runtime returned HTTP ${response.status}`)
  }
  if (!response.body) throw new Error('sub-agent runtime returned an empty body')

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
        args.emit('message.delta', {
          event: 'message.delta',
          run_id: args.runId,
          delta: visibleDelta,
        })
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

  while (true) {
    const { done, value } = await reader.read()
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
    args.emit('message.delta', {
      event: 'message.delta',
      run_id: args.runId,
      delta: trailingVisible,
    })
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
): Promise<void> {
  const sessionId = String(data.session_id || '').trim()
  const selectedAgent = decision.selectedAgent
  if (!sessionId) {
    socket.emit('run.failed', { event: 'run.failed', error: 'session_id is required for multi-agent sub-agent runs' })
    return
  }
  if (!selectedAgent?.baseUrl) {
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
  if (!existingSession) {
    createSession({
      id: sessionId,
      profile,
      source: runSource,
      title: preview,
      workspace: data.workspace || undefined,
    })
  }

  const emit = (event: string, payload: any) => {
    const tagged = { ...payload, session_id: sessionId }
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
  emit('subagent.start', {
    event: 'subagent.start',
    run_id: runId,
    subagent_id: selectedAgent.id,
    agent_name: selectedAgent.name,
    plan_node_ids: decision.delegatedNodeIds,
    task_index: 0,
    task_count: 1,
    goal: subagentGoal(decision),
    model: 'pi-mono',
  })

  const startedAt = Date.now()
  try {
    const url = normalizeChatUrl(selectedAgent.baseUrl, selectedAgent.chatPath)
    const streamResult = await streamSubagentCompletion({
      url,
      sessionId,
      agentId: selectedAgent.id,
      agentName: selectedAgent.name,
      messages: buildSubagentMessages(decision),
      emit,
      runId,
      goal: subagentGoal(decision),
    })
    const assistantContent = resolveSubagentAssistantContent({
      output: streamResult.output,
      agentName: selectedAgent.name,
      goal: subagentGoal(decision),
      toolCount: streamResult.toolCount,
      hadActivity: streamResult.hadActivity,
      lastEventText: streamResult.lastEventText,
    })
    if (!assistantContent) {
      throw new Error('sub-agent returned no visible output')
    }
    const assistantMessageId = addMessage({
      session_id: sessionId,
      role: 'assistant',
      content: assistantContent,
      timestamp: Math.floor(Date.now() / 1000),
      finish_reason: 'stop',
    })
    state.messages.push({
      id: assistantMessageId || state.messages.length + 1,
      session_id: sessionId,
      role: 'assistant',
      content: assistantContent,
      timestamp: Math.floor(Date.now() / 1000),
      finish_reason: 'stop',
    })

    updateSessionStats(sessionId)
    const usage = await calcAndUpdateUsage(sessionId, state, emit)
    updateUsage(sessionId, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      model: selectedAgent.name,
      profile,
    })

    emit('subagent.complete', {
      event: 'subagent.complete',
      run_id: runId,
      subagent_id: selectedAgent.id,
      agent_name: selectedAgent.name,
      plan_node_ids: decision.delegatedNodeIds,
      task_index: 0,
      task_count: 1,
      goal: subagentGoal(decision),
      status: 'completed',
      summary: assistantContent.slice(0, 240),
      output: assistantContent,
      duration_seconds: Math.round((Date.now() - startedAt) / 100) / 10,
      api_calls: 1,
    })
    emit('run.completed', {
      event: 'run.completed',
      run_id: runId,
      output: assistantContent,
      parsed_content: assistantContent,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    })
  } catch (error) {
    const message = sanitizeSubagentDisplayText(error instanceof Error ? error.message : String(error))
    logger.warn('[chat-run-socket] delegated sub-agent run failed for session %s agent=%s: %s', sessionId, selectedAgent.id, message)
    emit('subagent.complete', {
      event: 'subagent.complete',
      run_id: runId,
      subagent_id: selectedAgent.id,
      agent_name: selectedAgent.name,
      plan_node_ids: decision.delegatedNodeIds,
      task_index: 0,
      task_count: 1,
      goal: subagentGoal(decision),
      status: 'failed',
      summary: message,
      duration_seconds: Math.round((Date.now() - startedAt) / 100) / 10,
    })
    emit('run.failed', {
      event: 'run.failed',
      run_id: runId,
      error: `sub-agent ${selectedAgent.name} failed: ${message}`,
    })
  } finally {
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
