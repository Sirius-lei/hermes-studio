/**
 * ChatRunSocket — Socket.IO namespace /chat-run.
 *
 * Thin orchestrator that delegates to specialized modules:
 * - handle-bridge-run.ts → CLI bridge runs
 * - abort.ts             → run cancellation
 * - compression.ts       → context window management
 */

import { randomUUID } from 'crypto'
import type { Server, Socket } from 'socket.io'
import { logger } from '../../logger'
import { getSystemPrompt } from '../../../lib/llm-prompt'
import { clearSessionMessages, getSession, getSessionDetail  } from '../../../db/DiTing/session-store'
import {
  createCollaborationRun,
  getCollaborationRun,
  updateCollaborationRun,
} from '../../../db/DiTing/collaboration-run-store'
import {
  deletePendingSubagentTask,
  getPendingSubagentTask,
  type PendingSubagentTaskRecord,
} from '../../../db/DiTing/pending-subagent-task-store'
import { listOrDiscoverSubAgentsRegistry } from '../../../db/DiTing/sub-agent-store'
import { getActiveProfileName, getProfileDir, listProfileNamesFromDisk } from '../DiTing-profile'
import { AgentBridgeClient } from '../agent-bridge'
import { getAgentBridgeManager } from '../agent-bridge/manager'
import { redactAgentBridgeError } from '../agent-bridge/redact'
import { handleBridgeRun, resumeBridgeRun } from './handle-bridge-run'
import { handleCodingAgentRun } from './handle-coding-agent-run'
import { handleSubagentRun } from './handle-subagent-run'
import { handleAbort } from './abort'
import { getOrCreateSession, pushState } from './compression'
import { loadSessionStateFromDb, resolveRunSource } from './load-state'
import {
  resolveMultiAgentRoute,
  type MultiAgentRouteCandidate,
  type MultiAgentRouteDecision,
} from './multi-agent-routing'
import { handleSessionCommand, isSessionCommand, parseSessionCommand } from './session-command'
import { assertContentBlocksAccessibleToUser, contentBlocksToString, extractTextForPreview } from './content-blocks'
import type { ContentBlock, QueuedRun, SessionState } from './types'
import { authenticateUserToken, isAuthEnabled, type AuthenticatedUser } from '../../../middleware/user-auth'
import { userCanAccessProfile } from '../../../db/DiTing/users-store'
import { ensureDiTingRunWorkspace } from './workspace'
import {
  canAccessOwnedRecordWithContext,
  effectiveRequestedUserId,
  effectiveSessionOwnerId,
} from '../session-access'
import {
  applyProgressEvent,
  applyReasoningEvent,
  applyRouteEvent,
  applySubagentEvent,
  applyTerminalEvent,
  createCollaborationSnapshot,
  type CollaborationSnapshotState,
} from './collaboration-state'

export type { ContentBlock } from './types'

function normalizeMultiAgentCandidates(input: unknown): MultiAgentRouteCandidate[] {
  if (!Array.isArray(input)) return []
  return input
    .map((item) => {
      const raw = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {}
      const runtimeConfig = raw.runtimeConfig && typeof raw.runtimeConfig === 'object' && !Array.isArray(raw.runtimeConfig)
        ? raw.runtimeConfig as Record<string, unknown>
        : {}
      return {
        id: String(raw.id || raw.name || '').trim(),
        name: String(raw.name || raw.id || '').trim(),
        description: String(raw.description || '').trim(),
        baseUrl: String(raw.baseUrl || '').trim(),
        chatPath: String(raw.chatPath || runtimeConfig.chatPath || '/v1/chat/completions').trim() || '/v1/chat/completions',
        enabled: raw.enabled !== false
          && runtimeConfig.enabled !== false
          && raw.status !== 'offline'
          && raw.status !== 'draft',
        skills: Array.isArray(raw.skills) ? raw.skills as Array<{ name?: string; description?: string }> : [],
        tools: Array.isArray(raw.tools) ? raw.tools as Array<{ name?: string; description?: string }> : [],
      }
    })
    .filter(candidate => candidate.id && candidate.name)
}

async function resolveRuntimeSubAgentCandidates(
  profile: string,
  fallbackCandidates?: MultiAgentRouteCandidate[],
): Promise<MultiAgentRouteCandidate[]> {
  const registered = normalizeMultiAgentCandidates(await listOrDiscoverSubAgentsRegistry(profile))
  if (registered.length > 0) return registered
  return normalizeMultiAgentCandidates(fallbackCandidates || [])
}

function textFromStoredContent(content: unknown): string {
  if (typeof content !== 'string') return String(content || '').trim()
  const trimmed = content.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed) && parsed.every(item => item && typeof item === 'object' && 'type' in item)) {
      const blocks = parsed as ContentBlock[]
      const preview = extractTextForPreview(blocks).trim()
      if (preview) return preview
      return blocks.map((block) => {
        if (block.type === 'text') return block.text
        if (block.type === 'image') return `[图片: ${block.name || block.path}]`
        return `[文件: ${block.name || block.path}]`
      }).join('\n').trim()
    }
  } catch {
    // Keep original plain text content.
  }
  return trimmed
}

function buildRecentConversationContext(sessionId: string, sessionMap: Map<string, SessionState>, latestInput: string): string {
  const inMemory = sessionMap.get(sessionId)?.messages || []
  const dbMessages = inMemory.length > 0 ? [] : (getSessionDetail(sessionId)?.messages || [])
  const sourceMessages = (inMemory.length > 0 ? inMemory : dbMessages)
    .filter((message: any) => ['user', 'assistant', 'command'].includes(String(message?.display_role || message?.role || '')))
    .slice(-8)

  const lines = sourceMessages
    .map((message: any) => {
      const role = String(message?.display_role || message?.role || '').trim()
      const text = textFromStoredContent(message?.display_content ?? message?.content)
      if (!text) return ''
      const prefix = role === 'assistant' ? '助手' : role === 'command' ? '系统' : '用户'
      return `${prefix}: ${text}`
    })
    .filter(Boolean)

  const normalizedLatest = latestInput.trim()
  const deduped = normalizedLatest
    ? lines.filter(line => line !== `用户: ${normalizedLatest}`)
    : lines
  const context = deduped.join('\n').trim()
  if (!context) return ''
  return context.length > 2400 ? context.slice(context.length - 2400).trim() : context
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item || '').trim()).filter(Boolean)
}

function restorePendingSubagentDecision(
  pending: PendingSubagentTaskRecord,
  latestInput: string,
): MultiAgentRouteDecision | null {
  const raw = pending.route_decision_json && typeof pending.route_decision_json === 'object'
    ? pending.route_decision_json as Record<string, unknown>
    : {}
  const selectedRaw = raw.selectedAgent && typeof raw.selectedAgent === 'object'
    ? raw.selectedAgent as Record<string, unknown>
    : {}
  const selectedAgentId = String(selectedRaw.id || pending.agent_id || '').trim()
  const selectedAgentName = String(selectedRaw.name || pending.agent_name || '').trim()
  if (!selectedAgentId || !selectedAgentName) return null
  const baseConversationContext = String(raw.conversationContext || '').trim()
  const resumeContext = [
    baseConversationContext,
    pending.question ? `子智能体上一轮追问：${pending.question}` : '',
    latestInput ? `用户本轮补充：${latestInput}` : '',
  ].filter(Boolean).join('\n')
  return {
    enabled: raw.enabled !== false,
    shouldPlan: raw.shouldPlan !== false,
    summary: String(raw.summary || pending.last_result_summary || pending.objective || '').trim(),
    intent: String(raw.intent || 'pending_clarify').trim() || 'pending_clarify',
    category: String(raw.category || '待补充执行').trim() || '待补充执行',
    confidence: Number(raw.confidence || 0),
    reason: String(raw.reason || `检测到待恢复子任务，继续交由 ${pending.agent_name} 处理。`).trim(),
    executionMode: raw.executionMode === 'delegate_subagent' ? 'delegate_subagent' : 'DiTing_native',
    selectedAgent: {
      id: selectedAgentId,
      name: selectedAgentName,
      description: String(selectedRaw.description || '').trim(),
      baseUrl: String(selectedRaw.baseUrl || '').trim(),
      chatPath: String(selectedRaw.chatPath || '/v1/chat/completions').trim() || '/v1/chat/completions',
      enabled: selectedRaw.enabled !== false,
      skills: Array.isArray(selectedRaw.skills) ? selectedRaw.skills as Array<{ name?: string; description?: string }> : [],
      tools: Array.isArray(selectedRaw.tools) ? selectedRaw.tools as Array<{ name?: string; description?: string }> : [],
    },
    routeText: String(raw.routeText || `多智能体协作：检测到待恢复子任务，继续交由「${pending.agent_name}」执行。`).trim(),
    DiTingInstructions: typeof raw.DiTingInstructions === 'string' ? raw.DiTingInstructions : null,
    inputText: String(raw.inputText || pending.objective || '').trim(),
    conversationContext: resumeContext,
    todo: stringArray(raw.todo),
    constraints: stringArray(raw.constraints),
    plan: raw.plan && typeof raw.plan === 'object' ? raw.plan as any : null,
    delegatedNodeIds: stringArray(raw.delegatedNodeIds).length > 0
      ? stringArray(raw.delegatedNodeIds)
      : (pending.node_id ? [pending.node_id] : []),
  }
}

function patchPendingDecisionAgent(
  decision: MultiAgentRouteDecision,
  candidates: MultiAgentRouteCandidate[],
  pending: PendingSubagentTaskRecord,
): MultiAgentRouteDecision | null {
  const selected = decision.selectedAgent
  if (!selected) return null
  if (selected.baseUrl) return decision
  const matched = candidates.find(candidate => candidate.id === selected.id || candidate.name === selected.name)
  if (!matched?.baseUrl) return null
  return {
    ...decision,
    selectedAgent: {
      ...selected,
      baseUrl: matched.baseUrl,
      chatPath: matched.chatPath || selected.chatPath,
      skills: matched.skills || selected.skills,
      tools: matched.tools || selected.tools,
    },
  }
}

function currentProfileFromSocket(socket: Socket): string {
  const socketProfile = typeof socket.handshake.query?.profile === 'string'
    ? socket.handshake.query.profile.trim()
    : ''
  return socketProfile || getActiveProfileName() || 'default'
}

function requestedUserContextFromSocket(socket: Socket): string | null {
  const queryUserId = typeof socket.handshake?.query?.user_id === 'string'
    ? socket.handshake.query.user_id.trim()
    : ''
  return queryUserId || null
}

function redactBridgeReadyError(error: string, endpoint?: string): string {
  const normalized = error.replace(/^Error:\s*/, '').trim() || 'unknown error'
  return redactAgentBridgeError(normalized, endpoint, 'configured endpoint') || 'unknown error'
}

function isBridgeStatusLookupTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /^Agent bridge request timed out after \d+ms$/.test(message.trim())
}

function isBridgeMissingSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (/\[Errno 2\]\s+No such file or directory/i.test(message)) return true
  if (message.includes('FileNotFoundError')) return true
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { error_type?: unknown } }).response
    if (response && String(response.error_type || '') === 'FileNotFoundError') return true
  }
  return false
}

function isDiTingWorkerBackedSession(session?: { source?: string | null; agent?: string | null; agent_session_id?: string | null }): boolean {
  const source = session?.source || undefined
  // "api_server" is a legacy/default source value; DiTing sessions still use worker-backed runtime.
  // coding_agent runs have a separate lifecycle.
  if (!source || source === 'cli' || source === 'api_server') return true
  if (source === 'workflow') {
    const agent = String(session?.agent || '').trim()
    return agent !== 'claude' && agent !== 'codex' && !session?.agent_session_id
  }
  if (source !== 'global_agent') return false
  const agent = String(session?.agent || '').trim()
  return agent !== 'claude' && agent !== 'codex' && !session?.agent_session_id
}

function isBridgeRunSource(source?: string): boolean {
  return source === 'cli' || source === 'global_agent' || source === 'workflow'
}

export async function ensureBridgeReadyForChatRun(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const readiness = await getAgentBridgeManager().ensureReady({ timeoutMs: 1000, connectRetryMs: 0, recover: false })
    if (readiness.reachable) {
      return { ok: true }
    }
    return {
      ok: false,
      error: redactBridgeReadyError(readiness.error || `Agent Bridge is ${readiness.status}`, readiness.endpoint),
    }
  } catch (err) {
    return {
      ok: false,
      error: redactBridgeReadyError(err instanceof Error ? err.message : String(err)),
    }
  }
}

function isCodingAgentExecution(source: string | undefined, data?: { coding_agent_id?: string; agent_id?: string }): boolean {
  return source === 'coding_agent' || (source === 'workflow' && Boolean(data?.coding_agent_id || data?.agent_id))
}

export interface ChatRunAndWaitResult {
  ok: boolean
  event: 'run.completed' | 'run.failed'
  session_id: string
  run_id?: string
  output?: string | null
  reasoning?: string | null
  error?: string
}

type ChatRunAutoApprovalChoice = 'once' | 'session' | 'always'

export class ChatRunSocket {
  private nsp: ReturnType<Server['of']>
  private bridge = new AgentBridgeClient()
  /** sessionId → session state (messages, working status, events, run tracking) */
  private sessionMap = new Map<string, SessionState>()
  private bridgeResumePolls = new Set<string>()
  private readonly runWaiters = new Map<string, Set<(event: string, payload: any) => void>>()

  constructor(io: Server) {
    this.nsp = io.of('/chat-run')
  }

  init() {
    this.nsp.use(this.authMiddleware.bind(this))
    this.nsp.on('connection', this.onConnection.bind(this))
    logger.info('[chat-run-socket] Socket.IO ready at /chat-run')
  }

  private syncCollaborationSnapshot(
    collaborationRunId: string,
    snapshot: CollaborationSnapshotState,
    patch: {
      run_id?: string | null
      error?: string | null
      status?: 'running' | 'completed' | 'failed'
      route_json?: Record<string, unknown>
    } = {},
  ) {
    const normalizedStatus = patch.status
      ?? (snapshot.status === 'completed' ? 'completed' : snapshot.status === 'failed' ? 'failed' : 'running')
    updateCollaborationRun(collaborationRunId, {
      run_id: patch.run_id,
      error: patch.error,
      status: normalizedStatus,
      mode: snapshot.mode,
      intent: snapshot.intent,
      category: snapshot.category,
      reason: snapshot.reason,
      text: snapshot.text,
      objective: snapshot.objective,
      selected_agent_id: snapshot.selectedAgentId,
      selected_agent_name: snapshot.selectedAgentName,
      current_node_id: snapshot.currentNodeId,
      route_json: patch.route_json,
      snapshot_json: snapshot as unknown as Record<string, unknown>,
      events_json: snapshot.activity as unknown as Array<Record<string, unknown>>,
      ended_at: snapshot.endedAt,
    })
  }

  private appendCollaborationEvent(
    collaborationRunId: string | null | undefined,
    eventName: string,
    payload: Record<string, unknown>,
  ) {
    if (!collaborationRunId) return
    const record = getCollaborationRun(collaborationRunId)
    if (!record) return
    const currentSnapshot = (record.snapshot_json || {}) as unknown as CollaborationSnapshotState
    let nextSnapshot = currentSnapshot && currentSnapshot.runId
      ? currentSnapshot
      : createCollaborationSnapshot({
          runId: collaborationRunId,
          sessionId: record.session_id,
          objective: record.objective || record.text || '',
          mode: record.mode === 'delegate_subagent' ? 'delegate_subagent' : 'DiTing_native',
        })
    let routePatch = record.route_json
    if (eventName === 'agent.event') {
      const kind = String(payload.kind || '')
      if (kind === 'multi_agent_reasoning') {
        nextSnapshot = applyReasoningEvent(nextSnapshot, payload)
      } else if (kind === 'multi_agent_progress') {
        nextSnapshot = applyProgressEvent(nextSnapshot, payload)
      } else if (kind === 'multi_agent_route') {
        nextSnapshot = applyRouteEvent(nextSnapshot, payload)
        routePatch = {
          ...(record.route_json || {}),
          mode: payload.mode,
          intent: payload.intent,
          category: payload.category,
          reason: payload.reason,
          text: payload.text,
          todo: payload.todo,
          constraints: payload.constraints,
          plan: payload.plan,
          selected_agent: payload.selected_agent,
        }
      }
    } else if (eventName.startsWith('subagent.')) {
      nextSnapshot = applySubagentEvent(nextSnapshot, eventName, payload)
    } else if (eventName === 'run.completed') {
      if (payload.waiting_for_input === true || payload.status === 'clarify_required') {
        nextSnapshot = {
          ...nextSnapshot,
          status: 'running',
          text: typeof payload.output === 'string' && payload.output.trim() ? payload.output.trim() : nextSnapshot.text,
        }
      } else {
        nextSnapshot = applyTerminalEvent(nextSnapshot, 'completed', payload)
      }
    } else if (eventName === 'run.failed') {
      nextSnapshot = applyTerminalEvent(nextSnapshot, 'failed', payload)
    }
    this.syncCollaborationSnapshot(collaborationRunId, nextSnapshot, {
      run_id: typeof payload.run_id === 'string' ? payload.run_id : record.run_id,
      error: typeof payload.error === 'string' ? payload.error : record.error,
      status: eventName === 'run.completed'
        ? (payload.waiting_for_input === true || payload.status === 'clarify_required' ? 'running' : 'completed')
        : eventName === 'run.failed' ? 'failed' : 'running',
      route_json: routePatch,
    })
  }

  // --- Auth middleware ---

  private async authMiddleware(socket: Socket, next: (err?: Error) => void) {
    const token = socket.handshake.auth?.token as string | undefined
    if (!await isAuthEnabled()) {
      next()
      return
    }

    const user = await authenticateUserToken(token || '')
    if (!user) {
      return next(new Error('Authentication failed'))
    }
    const socketProfile = String(socket.handshake.query?.profile || '').trim()
    if (socketProfile && !this.canAccessProfile(user, socketProfile)) {
      return next(new Error('Profile access denied'))
    }
    socket.data.user = user
    next()
  }

  // --- Connection handler ---

  private onConnection(socket: Socket) {
    const socketUser = socket.data.user as AuthenticatedUser | undefined
    const requestedUserContext = () => effectiveRequestedUserId(socketUser, requestedUserContextFromSocket(socket))
    const socketProfile = (socket.handshake.query?.profile as string) || 'default'
    const currentProfile = () => socketProfile || getActiveProfileName() || 'default'
    const profileExists = (profile: string) => {
      if (!profile || profile === 'default') return true
      return listProfileNamesFromDisk().includes(profile)
    }
    const resolveRunProfile = (sessionId?: string, requested?: string) => {
      const requestedProfile = typeof requested === 'string' ? requested.trim() : ''
      if (requestedProfile) {
        if (!profileExists(requestedProfile)) throw new Error(`Profile "${requestedProfile}" does not exist`)
        if (socketUser && !this.canAccessProfile(socketUser, requestedProfile)) {
          throw new Error(`Profile "${requestedProfile}" is not available for this user`)
        }
        return requestedProfile
      }
      if (!sessionId) {
        const profile = currentProfile()
        if (socketUser && !this.canAccessProfile(socketUser, profile)) {
          throw new Error(`Profile "${profile}" is not available for this user`)
        }
        return profile
      }
      const storedSession = this.getAccessibleStoredSession(socketUser, sessionId, requestedUserContext())
      const storedProfile = storedSession?.profile || ''
      const profile = storedProfile && profileExists(storedProfile) ? storedProfile : currentProfile()
      if (socketUser && !this.canAccessProfile(socketUser, profile)) {
        throw new Error(`Profile "${profile}" is not available for this user`)
      }
      return profile
    }

    socket.on('run', async (data: {
      input: string | ContentBlock[]
      display_input?: string | ContentBlock[] | null
      display_role?: 'user' | 'command'
      storage_message?: string
      session_id?: string
      model?: string
      instructions?: string
      provider?: string
      model_groups?: Array<{ provider: string; models: string[] }>
      queue_id?: string
      workspace?: string | null
      source?: string
      session_source?: 'global_agent' | 'workflow'
      coding_agent_id?: 'claude-code' | 'codex'
      agent_id?: 'claude-code' | 'codex'
      mode?: 'scoped' | 'global'
      baseUrl?: string
      base_url?: string
      apiKey?: string
      api_key?: string
      apiMode?: string
      api_mode?: string
      multi_agent_mode?: boolean
      sub_agent_candidates?: MultiAgentRouteCandidate[]
      profile?: string
      // Local patch (reasoning-effort): per-session reasoning effort override.
      reasoning_effort?: string
    }) => {
      let runProfile: string
      try {
        assertContentBlocksAccessibleToUser(data.input, socketUser)
        if (data.display_input) assertContentBlocksAccessibleToUser(data.display_input, socketUser)
        if (socketUser?.role !== 'super_admin') data.workspace = null
        if (data.session_id) this.getAccessibleStoredSession(socketUser, data.session_id, requestedUserContext())
        runProfile = resolveRunProfile(data.session_id, data.profile)
      } catch (err) {
        socket.emit('run.failed', {
          event: 'run.failed',
          session_id: data.session_id,
          error: err instanceof Error ? err.message : String(err),
        })
        return
      }
      if (data.session_id) {
        const state = getOrCreateSession(this.sessionMap, data.session_id)
        const source = resolveRunSource(data.source, data.session_id)
        const command = parseSessionCommand(data.input)
        if (command && (isBridgeRunSource(source) || command.name === 'branch')) {
          try {
            await handleSessionCommand(data.session_id, command, {
              nsp: this.nsp,
              socket,
              sessionMap: this.sessionMap,
              bridge: this.bridge,
              profile: runProfile,
              model: data.model,
              provider: data.provider,
              model_groups: data.model_groups,
              instructions: data.instructions,
              queueId: data.queue_id,
              runQueuedItem: this.runQueuedItem.bind(this),
            })
          } catch (err) {
            this.emitToSession(socket, data.session_id, 'session.command', {
              event: 'session.command',
              command: command.rawName,
              ok: false,
              action: 'error',
              message: err instanceof Error ? err.message : String(err),
            })
          }
          return
        }
        if (state.isWorking) {
          const queueId = data.queue_id || `queue_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
          state.queue.push({
            queue_id: queueId,
            input: data.input,
            model: data.model,
            provider: data.provider,
            model_groups: data.model_groups,
            instructions: data.instructions,
            profile: runProfile,
            workspace: data.workspace,
            source,
            sessionSource: data.session_source,
            codingAgentId: data.coding_agent_id,
            agentId: data.agent_id,
            mode: data.mode,
            baseUrl: data.baseUrl,
            base_url: data.base_url,
            apiKey: data.apiKey,
            api_key: data.api_key,
            apiMode: data.apiMode,
            api_mode: data.api_mode,
            multiAgentMode: data.multi_agent_mode === true,
            subAgentCandidates: data.sub_agent_candidates,
            originSocketId: socket.id,
          })
          this.nsp.to(`session:${data.session_id}`).emit('run.queued', {
            event: 'run.queued',
            session_id: data.session_id,
            queue_length: state.queue.length,
            queued_messages: this.serializeQueuedMessages(state.queue),
          })
          logger.info('[chat-run-socket] queued run for session %s (queue: %d)', data.session_id, state.queue.length)
          return
        }
        state.events = []
        state.isWorking = !isCodingAgentExecution(source, data)
        state.profile = runProfile
        state.source = source
      }
      try {
        await this.handleRun(socket, data, runProfile)
      } catch (err) {
        if (data.session_id) {
          const state = this.sessionMap.get(data.session_id)
          const error = err instanceof Error ? err.message : String(err)
          if (data.multi_agent_mode === true && state?.collaborationRunId) {
            this.appendCollaborationEvent(state.collaborationRunId, 'run.failed', {
              event: 'run.failed',
              session_id: data.session_id,
              collaboration_run_id: state.collaborationRunId,
              error,
            })
          }
          if (state && !state.runId && !state.abortController && !state.activeRunMarker) {
            state.isWorking = false
            state.profile = undefined
          }
        }
        socket.emit('run.failed', {
          event: 'run.failed',
          session_id: data.session_id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })

    socket.on('cancel_queued_run', (data: { session_id?: string; queue_id?: string }) => {
      if (!data.session_id || !data.queue_id) return
      try {
        this.getAccessibleStoredSession(socketUser, data.session_id, requestedUserContext())
      } catch (err) {
        socket.emit('run.failed', {
          event: 'run.failed',
          session_id: data.session_id,
          error: err instanceof Error ? err.message : String(err),
        })
        return
      }
      const state = this.sessionMap.get(data.session_id)
      if (!state?.queue.length) return
      const before = state.queue.length
      state.queue = state.queue.filter(item => item.queue_id !== data.queue_id)
      if (state.queue.length === before) return
      this.nsp.to(`session:${data.session_id}`).emit('run.queued', {
        event: 'run.queued',
        session_id: data.session_id,
        queue_length: state.queue.length,
        queued_messages: this.serializeQueuedMessages(state.queue),
      })
      logger.info('[chat-run-socket] cancelled queued run %s for session %s (queue: %d)',
        data.queue_id, data.session_id, state.queue.length)
    })

    socket.on('resume', async (data: { session_id?: string }) => {
      if (!data.session_id) return
      const sid = data.session_id
      try {
        this.getAccessibleStoredSession(socketUser, sid, requestedUserContext())
      } catch (err) {
        socket.emit('resumed', {
          session_id: sid,
          messages: [],
          isWorking: false,
          events: [],
          error: err instanceof Error ? err.message : String(err),
        })
        return
      }
      socket.join(`session:${sid}`)
      await this.resumeSession(socket, sid)
    })

    socket.on('abort', (data: { session_id?: string }) => {
      if (data.session_id) {
        try {
          this.getAccessibleStoredSession(socketUser, data.session_id, requestedUserContext())
        } catch (err) {
          socket.emit('run.failed', {
            event: 'run.failed',
            session_id: data.session_id,
            error: err instanceof Error ? err.message : String(err),
          })
          return
        }
        void handleAbort(this.nsp, socket, data.session_id, this.sessionMap, this.bridge, this.runQueuedItem.bind(this))
      }
    })

    socket.on('approval.respond', async (data: { session_id?: string; approval_id?: string; choice?: string }) => {
      if (!data.session_id || !data.approval_id) return
      try {
        this.getAccessibleStoredSession(socketUser, data.session_id, requestedUserContext())
      } catch (err) {
        this.emitToSession(socket, data.session_id, 'approval.resolved', {
          event: 'approval.resolved',
          approval_id: data.approval_id,
          choice: data.choice || 'deny',
          resolved: false,
          error: err instanceof Error ? err.message : String(err),
        })
        return
      }
      try {
        const result = await this.bridge.approvalRespond(data.approval_id, data.choice || 'deny')
        this.emitToSession(socket, data.session_id, 'approval.resolved', {
          event: 'approval.resolved',
          approval_id: data.approval_id,
          choice: data.choice || 'deny',
          resolved: Boolean(result.resolved),
        })
      } catch (err) {
        this.emitToSession(socket, data.session_id, 'approval.resolved', {
          event: 'approval.resolved',
          approval_id: data.approval_id,
          choice: data.choice || 'deny',
          resolved: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })

    socket.on('clarify.respond', async (data: { session_id?: string; clarify_id?: string; response?: string }) => {
      if (!data.session_id || !data.clarify_id) return
      try {
        this.getAccessibleStoredSession(socketUser, data.session_id, requestedUserContext())
      } catch (err) {
        this.emitToSession(socket, data.session_id, 'clarify.resolved', {
          event: 'clarify.resolved',
          clarify_id: data.clarify_id,
          resolved: false,
          error: err instanceof Error ? err.message : String(err),
        })
        return
      }
      this.clearClarifyEventState(data.session_id, data.clarify_id)
      try {
        const result = await this.bridge.clarifyRespond(data.clarify_id, data.response || '')
        this.emitToSession(socket, data.session_id, 'clarify.resolved', {
          event: 'clarify.resolved',
          clarify_id: data.clarify_id,
          resolved: Boolean((result as any)?.resolved),
        })
      } catch (err) {
        this.emitToSession(socket, data.session_id, 'clarify.resolved', {
          event: 'clarify.resolved',
          clarify_id: data.clarify_id,
          resolved: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })
  }

  // --- Run dispatcher ---

  private async handleRun(
    socket: Socket,
    data: {
      input: string | ContentBlock[]
      display_input?: string | ContentBlock[] | null
      display_role?: 'user' | 'command'
      storage_message?: string
      session_id?: string
      model?: string
      provider?: string
      model_groups?: Array<{ provider: string; models: string[] }>
      instructions?: string
      workspace?: string | null
      source?: string
      session_source?: 'global_agent' | 'workflow'
      queue_id?: string
      peerExcludeSocketId?: string
      coding_agent_id?: 'claude-code' | 'codex'
      agent_id?: 'claude-code' | 'codex'
      mode?: 'scoped' | 'global'
      baseUrl?: string
      base_url?: string
      apiKey?: string
      api_key?: string
      apiMode?: string
      api_mode?: string
      multi_agent_mode?: boolean
      sub_agent_candidates?: MultiAgentRouteCandidate[]
      onEvent?: (event: string, payload: any) => void
    },
    profile: string,
    skipUserMessage = false,
  ) {
    const source = resolveRunSource(data.source, data.session_id)
    const effectiveSubAgentCandidates = data.multi_agent_mode === true
      ? await resolveRuntimeSubAgentCandidates(profile, data.sub_agent_candidates || [])
      : normalizeMultiAgentCandidates(data.sub_agent_candidates || [])
    if (data.session_id && isBridgeRunSource(source) && isSessionCommand(data.input)) return

    const sessionId = data.session_id ? String(data.session_id).trim() : ''
    const objectiveText = extractTextForPreview(data.display_input ?? data.input)
    const pendingSubagentTask = !isCodingAgentExecution(source, data) && sessionId
      ? getPendingSubagentTask(sessionId)
      : null
    const socketUser = socket.data.user as AuthenticatedUser | undefined
    const collaborationRunId = sessionId
      ? (
          pendingSubagentTask?.collaboration_run_id
          || (data.multi_agent_mode === true ? randomUUID() : null)
        )
      : null
    const ensureCollaborationRunState = (
      targetRunId: string | null | undefined,
      objectiveOverride?: string | null,
      mode: 'delegate_subagent' | 'DiTing_native' = 'DiTing_native',
    ) => {
      if (!targetRunId || !sessionId) return
      const existingRun = getCollaborationRun(targetRunId)
      const nextObjective = String(objectiveOverride || objectiveText || '').trim() || objectiveText
      if (!existingRun) {
        createCollaborationRun({
          id: targetRunId,
          session_id: sessionId,
          user_id: effectiveSessionOwnerId(socketUser, requestedUserContextFromSocket(socket)),
          profile,
          status: 'running',
          mode,
          objective: nextObjective,
          text: nextObjective,
          route_json: { enabled: true },
          snapshot_json: createCollaborationSnapshot({
            runId: targetRunId,
            sessionId,
            objective: nextObjective,
            mode,
          }) as unknown as Record<string, unknown>,
          events_json: [],
        })
      }
      const state = getOrCreateSession(this.sessionMap, sessionId)
      state.collaborationRunId = targetRunId
    }
    const emitCollaborationEvent = (
      eventName: string,
      payload: Record<string, unknown>,
      targetRunId: string | null | undefined = collaborationRunId,
    ) => {
      if (data.onEvent) data.onEvent(eventName, payload)
      this.appendCollaborationEvent(targetRunId, eventName, payload)
    }

    const continueWithDiTing = async ({ input, instructions, collaborationRunId: nextCollaborationRunId, objective }: {
      input: string
      instructions: string
      collaborationRunId?: string
      objective?: string
    }) => {
      const bridgeReady = await ensureBridgeReadyForChatRun()
      if (!bridgeReady.ok) {
        throw new Error(`Agent Bridge is not reachable: ${bridgeReady.error}`)
      }
      if (sessionId) deletePendingSubagentTask(sessionId)
      const activeCollaborationRunId = nextCollaborationRunId || collaborationRunId || undefined
      if (nextCollaborationRunId && collaborationRunId && nextCollaborationRunId !== collaborationRunId) {
        updateCollaborationRun(collaborationRunId, {
          status: 'failed',
          error: '子智能体节点执行失败，已切换为主智能体重新规划。',
          ended_at: Date.now(),
        })
      }
      ensureCollaborationRunState(activeCollaborationRunId, objective || input, 'DiTing_native')
      await handleBridgeRun(
        this.nsp,
        socket,
        {
          input,
          display_input: null,
          display_role: 'command',
          storage_message: '',
          session_id: sessionId,
          model: data.model,
          provider: data.provider,
          model_groups: data.model_groups,
          instructions,
          workspace: data.workspace,
          source: data.source,
          session_source: data.session_source,
          peerExcludeSocketId: data.peerExcludeSocketId,
          collaboration_run_id: activeCollaborationRunId,
          onEvent: (eventName, payload) => {
            emitCollaborationEvent(eventName, payload, activeCollaborationRunId)
          },
        },
        profile,
        this.sessionMap,
        this.bridge,
        true,
        loadSessionStateFromDb,
        this.dequeueNextQueuedRun.bind(this),
      )
    }

    if (collaborationRunId && sessionId) {
      ensureCollaborationRunState(
        collaborationRunId,
        objectiveText || pendingSubagentTask?.objective || '',
        pendingSubagentTask ? 'delegate_subagent' : 'DiTing_native',
      )
    } else if (sessionId) {
      const state = getOrCreateSession(this.sessionMap, sessionId)
      state.collaborationRunId = undefined
    }

    if (!isCodingAgentExecution(source, data)) {
      const conversationContext = sessionId
        ? buildRecentConversationContext(sessionId, this.sessionMap, objectiveText)
        : ''
      if (pendingSubagentTask && sessionId) {
        const restored = restorePendingSubagentDecision(pendingSubagentTask, objectiveText || contentBlocksToString(data.input))
        const resumedDecision = restored
          ? patchPendingDecisionAgent(restored, effectiveSubAgentCandidates, pendingSubagentTask)
          : null
        if (resumedDecision?.selectedAgent?.baseUrl) {
          const routeEvent = {
            event: 'agent.event',
            kind: 'multi_agent_route',
            mode: resumedDecision.executionMode,
            intent: resumedDecision.intent,
            category: resumedDecision.category,
            confidence: resumedDecision.confidence,
            reason: `检测到待恢复子任务，继续交由 ${pendingSubagentTask.agent_name} 执行。`,
            todo: resumedDecision.todo,
            constraints: resumedDecision.constraints,
            plan: resumedDecision.plan,
            collaboration_run_id: collaborationRunId || undefined,
            selected_agent: resumedDecision.selectedAgent
              ? {
                  id: resumedDecision.selectedAgent.id,
                  name: resumedDecision.selectedAgent.name,
                  baseUrl: resumedDecision.selectedAgent.baseUrl || '',
                }
              : null,
            text: `多智能体协作：恢复待补充子任务，继续由「${pendingSubagentTask.agent_name}」执行。`,
          }
          pushState(this.sessionMap, sessionId, 'agent.event', {
            ...routeEvent,
            session_id: sessionId,
          })
          emitCollaborationEvent('agent.event', {
            ...routeEvent,
            session_id: sessionId,
          })
          this.emitToSession(socket, sessionId, 'agent.event', routeEvent)
          await handleSubagentRun(
            this.nsp,
            socket,
            {
              ...data,
              sub_agent_candidates: effectiveSubAgentCandidates,
              collaboration_run_id: collaborationRunId || undefined,
              resume_pending_subagent_task: pendingSubagentTask,
              onEvent: (eventName, payload) => {
                emitCollaborationEvent(eventName, payload)
              },
            },
            profile,
            this.sessionMap,
            resumedDecision,
            this.dequeueNextQueuedRun.bind(this),
            skipUserMessage,
            {
              continueWithDiTing,
            },
          )
          return
        }
        deletePendingSubagentTask(sessionId)
      }
      const routeDecision = await resolveMultiAgentRoute({
        enabled: data.multi_agent_mode === true,
        input: data.input,
        candidates: effectiveSubAgentCandidates,
        conversationContext,
        profile,
        provider: data.provider,
        model: data.model,
        onProgress: data.session_id
          ? (progressEvent) => {
              const payload = {
                event: 'agent.event',
                kind: 'multi_agent_progress',
                ...(collaborationRunId ? { collaboration_run_id: collaborationRunId } : {}),
                ...progressEvent,
              }
              pushState(this.sessionMap, data.session_id!, 'agent.event', {
                ...payload,
                session_id: data.session_id,
              })
              emitCollaborationEvent('agent.event', {
                ...payload,
                session_id: data.session_id,
              })
              this.emitToSession(socket, data.session_id!, 'agent.event', payload)
            }
          : undefined,
        onReasoning: data.session_id
          ? (reasoningEvent) => {
              const payload = {
                event: 'agent.event',
                kind: 'multi_agent_reasoning',
                ...(collaborationRunId ? { collaboration_run_id: collaborationRunId } : {}),
                ...reasoningEvent,
              }
              pushState(this.sessionMap, data.session_id!, 'agent.event', {
                ...payload,
                session_id: data.session_id,
              })
              emitCollaborationEvent('agent.event', {
                ...payload,
                session_id: data.session_id,
              })
              this.emitToSession(socket, data.session_id!, 'agent.event', payload)
            }
          : undefined,
      })
      if (data.session_id && routeDecision.enabled) {
        const routeEvent = {
          event: 'agent.event',
          kind: 'multi_agent_route',
          mode: routeDecision.executionMode,
          intent: routeDecision.intent,
          category: routeDecision.category,
          confidence: routeDecision.confidence,
          reason: routeDecision.reason,
          todo: routeDecision.todo,
          constraints: routeDecision.constraints,
          plan: routeDecision.plan,
          collaboration_run_id: collaborationRunId || undefined,
          selected_agent: routeDecision.selectedAgent
            ? {
                id: routeDecision.selectedAgent.id,
                name: routeDecision.selectedAgent.name,
                baseUrl: routeDecision.selectedAgent.baseUrl || '',
              }
            : null,
          text: routeDecision.routeText,
        }
        pushState(this.sessionMap, data.session_id, 'agent.event', {
          ...routeEvent,
          session_id: data.session_id,
        })
        emitCollaborationEvent('agent.event', {
          ...routeEvent,
          session_id: data.session_id,
        })
        if (collaborationRunId) {
          updateCollaborationRun(collaborationRunId, {
            mode: routeDecision.executionMode,
            intent: routeDecision.intent,
            category: routeDecision.category,
            reason: routeDecision.reason,
            text: routeDecision.routeText,
            objective: routeDecision.plan?.objective || objectiveText,
            selected_agent_id: routeDecision.selectedAgent?.id || '',
            selected_agent_name: routeDecision.selectedAgent?.name || '',
            route_json: {
              enabled: routeDecision.enabled,
              should_plan: routeDecision.shouldPlan,
              mode: routeDecision.executionMode,
              confidence: routeDecision.confidence,
              summary: routeDecision.summary,
              intent: routeDecision.intent,
              category: routeDecision.category,
              reason: routeDecision.reason,
              text: routeDecision.routeText,
              todo: routeDecision.todo,
              constraints: routeDecision.constraints,
              delegated_node_ids: routeDecision.delegatedNodeIds,
              plan: routeDecision.plan,
              selected_agent: routeDecision.selectedAgent
                ? {
                    id: routeDecision.selectedAgent.id,
                    name: routeDecision.selectedAgent.name,
                    baseUrl: routeDecision.selectedAgent.baseUrl || '',
                  }
                : null,
            },
          })
        }
        this.emitToSession(socket, data.session_id, 'agent.event', routeEvent)
      }
      if (routeDecision.executionMode === 'delegate_subagent' && routeDecision.selectedAgent) {
        await handleSubagentRun(
          this.nsp,
          socket,
          {
            ...data,
            sub_agent_candidates: effectiveSubAgentCandidates,
            collaboration_run_id: collaborationRunId || undefined,
            onEvent: (eventName, payload) => {
              emitCollaborationEvent(eventName, payload)
            },
          },
          profile,
          this.sessionMap,
          routeDecision,
          this.dequeueNextQueuedRun.bind(this),
          skipUserMessage,
          {
            continueWithDiTing,
          },
        )
        return
      }

      const bridgeReady = await ensureBridgeReadyForChatRun()
      if (!bridgeReady.ok) {
        let shouldDequeueNext = false
        let queueRemaining = 0
        if (data.session_id) {
          const state = this.sessionMap.get(data.session_id)
          queueRemaining = state?.queue?.length ?? 0
          const canReleaseCurrentRun = state && !state.runId && !state.abortController && !state.activeRunMarker
          if (canReleaseCurrentRun) {
            if (queueRemaining > 0) {
              const nextQueuedRun = state.queue[0]
              state.isWorking = true
              state.profile = nextQueuedRun?.profile || profile
              state.source = nextQueuedRun?.source
              shouldDequeueNext = true
            } else {
              state.isWorking = false
              state.profile = undefined
            }
          }
        }
        const payload: {
          event: 'run.failed'
          session_id?: string
          error: string
          queue_remaining?: number
        } = {
          event: 'run.failed',
          session_id: data.session_id,
          ...(collaborationRunId ? { collaboration_run_id: collaborationRunId } : {}),
          error: `Agent Bridge is not reachable: ${bridgeReady.error}`,
        }
        if (queueRemaining > 0) payload.queue_remaining = queueRemaining
        emitCollaborationEvent('run.failed', payload)
        socket.emit('run.failed', payload)
        if (data.session_id && shouldDequeueNext) {
          this.dequeueNextQueuedRun(socket, data.session_id, profile)
        }
        return
      }

      let fullInstructions = data.instructions
        ? `${getSystemPrompt(undefined, { source })}\n${data.instructions}`
        : getSystemPrompt(undefined, { source })
      if (routeDecision.DiTingInstructions) {
        fullInstructions = `${fullInstructions}\n\n${routeDecision.DiTingInstructions}`
      }
      if (data.session_id) {
        const sessionRow = getSession(data.session_id)
        const workspace = await ensureDiTingRunWorkspace(profile, sessionRow?.workspace || data.workspace, {
          userId: sessionRow?.user_id || effectiveSessionOwnerId(socketUser, requestedUserContextFromSocket(socket)) || null,
          sessionId: data.session_id,
          allowCustomWorkspace: socketUser?.role === 'super_admin',
        })
        if (workspace) {
          const workspaceCtx = `[Current working directory: ${workspace}]`
          fullInstructions = `\n${workspaceCtx}\n${fullInstructions}`
        }
      }

      await handleBridgeRun(
        this.nsp, socket, {
          ...data,
          instructions: fullInstructions,
          collaboration_run_id: collaborationRunId || undefined,
          onEvent: (eventName, payload) => {
            emitCollaborationEvent(eventName, payload)
          },
        }, profile,
        this.sessionMap, this.bridge,
        skipUserMessage,
        loadSessionStateFromDb,
        this.dequeueNextQueuedRun.bind(this),
      )
      return
    }

    await handleCodingAgentRun(
      this.nsp,
      socket,
      data,
      profile,
      this.sessionMap,
    )
  }

  // --- Resume ---

  private async resumeSession(socket: Socket, sid: string) {
    let state = this.sessionMap.get(sid)
    if (!state) {
      state = await loadSessionStateFromDb(sid, this.sessionMap)
      this.sessionMap.set(sid, state)
    }
    await this.reattachBridgeRun(socket, sid, state)
    const resumeEvents = state.isWorking
      ? state.events
      : (state.events || []).filter(evt => evt?.event === 'run.reattach_failed')
    const sessionDetail = getSessionDetail(sid)
    socket.emit('resumed', {
      session_id: sid,
      messages: state.messages,
      messageTotal: state.messageTotal,
      messageLoadedCount: state.messageLoadedCount,
      messagePageLimit: state.messagePageLimit,
      hasMoreBefore: state.hasMoreBefore,
      parentSessionId: sessionDetail?.parent_session_id || null,
      forkPointMessageId: sessionDetail?.fork_point_message_id || null,
      parentTitle: sessionDetail?.parent_title || null,
      parentLastMessage: sessionDetail?.parent_last_message || null,
      parentLastMessageRole: sessionDetail?.parent_last_message_role || null,
      isWorking: state.isWorking,
      isAborting: state.isAborting || false,
      events: resumeEvents,
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
      contextTokens: state.contextTokens,
      queueLength: state.queue?.length || 0,
      queueMessages: this.serializeQueuedMessages(state.queue || []),
    })

    logger.info('[chat-run-socket] socket %s resumed session %s (working: %s, messages: %d)',
      socket.id, sid, state.isWorking, state.messages.length)
  }

  private async reattachBridgeRun(socket: Socket, sid: string, state: SessionState) {
    if (state.runId && state.isWorking) return
    const session = getSession(sid)
    const source = state.source || session?.source
    if (!isDiTingWorkerBackedSession({ source, agent: session?.agent, agent_session_id: session?.agent_session_id })) return
    const profile = session?.profile || currentProfileFromSocket(socket)
    let pollKey: string | undefined
    try {
      const status = await this.bridge.statusIfLoaded(sid, profile, { timeoutMs: 1000 }) as Record<string, unknown>
      const running = status.running === true
      const runId = typeof status.current_run_id === 'string' ? status.current_run_id : ''
      if (!running || !runId) return
      pollKey = `${sid}:${runId}`
      if (this.bridgeResumePolls.has(pollKey)) return
      this.bridgeResumePolls.add(pollKey)
      state.isWorking = true
      state.isAborting = state.isAborting === true
      state.runId = runId
      state.activeRunMarker = undefined
      state.profile = profile
      state.source = source === 'global_agent' ? 'global_agent' : 'cli'
      state.events = []
      const instructions = this.resumeInstructionsForSession(sid)
      void resumeBridgeRun(
        this.nsp,
        socket,
        {
          sessionId: sid,
          runId,
          profile,
          instructions,
          model: session?.model,
          provider: session?.provider,
          source,
        },
        this.sessionMap,
        this.bridge,
        this.dequeueNextQueuedRun.bind(this),
      ).finally(() => {
        if (pollKey) this.bridgeResumePolls.delete(pollKey!)
      })
      logger.info('[chat-run-socket] reattached running bridge run %s for session %s', runId, sid)
    } catch (err) {
      if (pollKey) this.bridgeResumePolls.delete(pollKey)
      if (isBridgeStatusLookupTimeout(err)) {
        logger.debug(err, '[chat-run-socket] bridge status lookup timed out while resuming session %s', sid)
        return
      }
      if (isBridgeMissingSessionError(err)) {
        state.isWorking = false
        state.isAborting = false
        state.runId = undefined
        state.activeRunMarker = undefined
        logger.info('[chat-run-socket] bridge session state missing while resuming session %s, cleared stale local run state', sid)
        return
      }
      logger.warn(err, '[chat-run-socket] bridge status lookup failed while resuming session %s', sid)
      const endpoint = getAgentBridgeManager().getRuntimeState?.().endpoint
      const error = redactBridgeReadyError(err instanceof Error ? err.message : String(err), endpoint)
      const payload = {
        event: 'run.reattach_failed',
        session_id: sid,
        error,
        message: `Unable to confirm Agent Bridge status while resuming: ${error}`,
        text: `Unable to confirm Agent Bridge status while resuming: ${error}`,
      }
      const nextEvents = [...(state.events || [])]
      const lastEvent = nextEvents[nextEvents.length - 1]
      if (lastEvent?.event !== 'run.reattach_failed' || lastEvent?.data?.error !== error) {
        nextEvents.push({ event: 'run.reattach_failed', data: payload })
        state.events = nextEvents
      }
      this.emitToSession(socket, sid, 'run.reattach_failed', payload)
    }
  }

  private resumeInstructionsForSession(sessionId: string): string {
    const sessionRow = getSession(sessionId)
    let fullInstructions = getSystemPrompt(undefined, { source: sessionRow?.source })
    if (sessionRow?.workspace) {
      fullInstructions = `\n[Current working directory: ${sessionRow.workspace}]\n${fullInstructions}`
    }
    return fullInstructions
  }

  // --- Queue ---

  private dequeueNextQueuedRun(socket: Socket, sessionId: string, fallbackProfile = 'default') {
    const state = this.sessionMap.get(sessionId)
    if (!state?.queue.length) return false

    const next = state.queue.shift()!
    state.isWorking = true
    state.profile = next.profile || fallbackProfile
    state.source = next.source
    logger.info('[chat-run-socket] dequeuing queued run for session %s (remaining: %d)', sessionId, state.queue.length)
    this.nsp.to(`session:${sessionId}`).emit('run.queued', {
      event: 'run.queued',
      session_id: sessionId,
      queue_length: state.queue.length,
      dequeued_queue_id: next.queue_id,
      queued_messages: this.serializeQueuedMessages(state.queue),
    })
    this.runQueuedItem(socket, sessionId, next, fallbackProfile)
    return true
  }

  private runQueuedItem(socket: Socket, sessionId: string, next: QueuedRun, fallbackProfile = 'default') {
    const skipUserMessage = next.displayInput === null
    void this.handleRun(socket, {
      input: next.input,
      display_input: next.displayInput,
      display_role: next.displayRole,
      storage_message: next.storageMessage,
      session_id: sessionId,
      model: next.model,
      provider: next.provider,
      model_groups: next.model_groups,
      instructions: next.instructions,
      workspace: next.workspace,
      source: next.source,
      session_source: next.sessionSource,
      queue_id: next.queue_id,
      peerExcludeSocketId: next.originSocketId,
      coding_agent_id: next.codingAgentId,
      agent_id: next.agentId,
      mode: next.mode,
      baseUrl: next.baseUrl,
      base_url: next.base_url,
      apiKey: next.apiKey,
      api_key: next.api_key,
      apiMode: next.apiMode,
      api_mode: next.api_mode,
      multi_agent_mode: next.multiAgentMode,
      sub_agent_candidates: next.subAgentCandidates,
    }, next.profile || fallbackProfile, skipUserMessage).catch((err) => {
      const state = this.sessionMap.get(sessionId)
      const error = err instanceof Error ? err.message : String(err)
      if (next.multiAgentMode === true && state?.collaborationRunId) {
        this.appendCollaborationEvent(state.collaborationRunId, 'run.failed', {
          event: 'run.failed',
          session_id: sessionId,
          collaboration_run_id: state.collaborationRunId,
          error,
        })
      }
      this.nsp.to(`session:${sessionId}`).emit('run.failed', {
        event: 'run.failed',
        session_id: sessionId,
        error,
      })
    })
  }

  // --- Helpers ---

  async runAndWait(
    data: {
      input: string | ContentBlock[]
      display_input?: string | ContentBlock[] | null
      display_role?: 'user' | 'command'
      storage_message?: string
      session_id: string
      model?: string
      provider?: string
      model_groups?: Array<{ provider: string; models: string[] }>
      instructions?: string
      workspace?: string | null
      source?: string
      session_source?: 'global_agent' | 'workflow'
      queue_id?: string
      coding_agent_id?: 'claude-code' | 'codex'
      agent_id?: 'claude-code' | 'codex'
      mode?: 'scoped' | 'global'
      baseUrl?: string
      base_url?: string
      apiKey?: string
      api_key?: string
      apiMode?: string
      api_mode?: string
      multi_agent_mode?: boolean
      sub_agent_candidates?: MultiAgentRouteCandidate[]
      profile?: string
      reasoning_effort?: string
    },
    options: { profile?: string; user?: AuthenticatedUser; timeoutMs?: number; approvalChoice?: ChatRunAutoApprovalChoice } = {},
  ): Promise<ChatRunAndWaitResult> {
    const sessionId = String(data.session_id || '').trim()
    if (!sessionId) throw new Error('session_id is required')
    const profile = options.profile || data.profile || getSession(sessionId)?.profile || getActiveProfileName() || 'default'
    const source = resolveRunSource(data.source, sessionId)
    const state = getOrCreateSession(this.sessionMap, sessionId)
    state.events = []
    state.isWorking = !isCodingAgentExecution(source, data)
    state.profile = profile
    state.source = source

    return new Promise<ChatRunAndWaitResult>((resolve) => {
      let settled = false
      let output = ''
      let reasoning = ''
      let runId = ''
      const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : null
      const waiters = this.runWaiters.get(sessionId) || new Set<(event: string, payload: any) => void>()
      const finish = (result: Omit<ChatRunAndWaitResult, 'session_id'>) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        waiters.delete(onEvent)
        if (waiters.size === 0) this.runWaiters.delete(sessionId)
        resolve({
          session_id: sessionId,
          run_id: runId || result.run_id,
          output: output || result.output,
          reasoning: reasoning || result.reasoning,
          ...result,
        })
      }
      const respondToApproval = async (payload: any = {}) => {
        const choice = options.approvalChoice
        if (!choice || settled) return
        const approvalId = typeof payload.approval_id === 'string' ? payload.approval_id : ''
        const rawChoices = Array.isArray(payload.choices) ? payload.choices.map((item: unknown) => String(item)) : []
        const choices = rawChoices.length > 0 ? rawChoices : ['once', 'session', 'deny']
        if (!approvalId) {
          finish({ ok: false, event: 'run.failed', output, reasoning, error: 'approval required' })
          return
        }
        if (!choices.includes(choice)) {
          finish({ ok: false, event: 'run.failed', output, reasoning, error: `approval choice "${choice}" is not available` })
          return
        }
        try {
          const result = await this.bridge.approvalRespond(approvalId, choice)
          const resolvedPayload = {
            event: 'approval.resolved',
            session_id: sessionId,
            approval_id: approvalId,
            choice,
            resolved: Boolean((result as any)?.resolved),
          }
          this.nsp.to(`session:${sessionId}`).emit('approval.resolved', resolvedPayload)
          onEvent('approval.resolved', resolvedPayload)
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          this.nsp.to(`session:${sessionId}`).emit('approval.resolved', {
            event: 'approval.resolved',
            session_id: sessionId,
            approval_id: approvalId,
            choice,
            resolved: false,
            error,
          })
          finish({ ok: false, event: 'run.failed', output, reasoning, error })
        }
      }
      const onEvent = (event: string, payload: any = {}) => {
        if (typeof payload.run_id === 'string' && payload.run_id) runId = payload.run_id
        if (event === 'message.delta' && typeof payload.delta === 'string') output += payload.delta
        if ((event === 'reasoning.delta' || event === 'thinking.delta') && typeof payload.delta === 'string') reasoning += payload.delta
        if (event === 'approval.requested') {
          void respondToApproval(payload)
        } else if (event === 'run.completed') {
          finish({
            ok: true,
            event: 'run.completed',
            run_id: payload.run_id,
            output: typeof payload.output === 'string' && payload.output ? payload.output : output,
            reasoning: typeof payload.reasoning === 'string' && payload.reasoning ? payload.reasoning : reasoning,
          })
        } else if (event === 'run.failed') {
          finish({
            ok: false,
            event: 'run.failed',
            run_id: payload.run_id,
            output,
            reasoning,
            error: payload.error ? String(payload.error) : 'chat-run failed',
          })
        }
      }
      const timer = timeoutMs
        ? setTimeout(() => {
            finish({ ok: false, event: 'run.failed', error: `chat-run timed out after ${timeoutMs}ms` })
          }, timeoutMs)
        : null
      waiters.add(onEvent)
      this.runWaiters.set(sessionId, waiters)

      const fakeSocket = {
        id: `workflow-run-${sessionId}`,
        connected: true,
        data: { user: options.user },
        join: () => {},
        to: (room: string) => ({
          emit: (event: string, payload: any) => {
            this.nsp.to(room).emit(event, payload)
            onEvent(event, payload)
          },
        }),
        emit: (event: string, payload: any) => onEvent(event, payload),
      } as unknown as Socket

      this.handleRun(fakeSocket, { ...data, onEvent }, profile)
        .catch(err => finish({ ok: false, event: 'run.failed', error: err instanceof Error ? err.message : String(err) }))
    })
  }

  async abortSession(sessionId: string, reason = 'Run canceled'): Promise<void> {
    const sid = String(sessionId || '').trim()
    if (!sid) return
    const fakeSocket = {
      id: `workflow-abort-${sid}`,
      connected: false,
      data: {},
      emit: () => {},
      join: () => {},
      to: (room: string) => ({ emit: (event: string, payload: any) => this.nsp.to(room).emit(event, payload) }),
    } as unknown as Socket
    await handleAbort(
      this.nsp,
      fakeSocket,
      sid,
      this.sessionMap,
      this.bridge,
      this.runQueuedItem.bind(this),
    )
    this.emitExternalEvent(sid, 'run.failed', {
      event: 'run.failed',
      error: reason,
    })
  }

  emitExternalEvent(sessionId: string, event: string, payload: any) {
    const tagged = { ...payload, session_id: sessionId }
    const state = this.sessionMap.get(sessionId)
    if (state?.isWorking) {
      state.events.push({ event, data: tagged })
      if (state.events.length > 200) state.events.splice(0, state.events.length - 200)
    }
    this.nsp.to(`session:${sessionId}`).emit(event, tagged)
    const waiters = this.runWaiters.get(sessionId)
    if (waiters) {
      for (const waiter of waiters) waiter(event, tagged)
    }
  }

  markExternalRunCompleted(sessionId: string, event: string) {
    const state = this.sessionMap.get(sessionId)
    if (!state) return
    state.isWorking = false
    state.abortController = undefined
    state.runId = undefined
    state.activeRunMarker = undefined
    state.events = []
    state.responseRun = undefined
    state.profile = undefined
    logger.info('[chat-run-socket] external run completed for session %s (%s)', sessionId, event)
    if (state.queue.length > 0) {
      const socket = this.socketForQueuedRun(sessionId, state.queue[0])
      if (socket) this.dequeueNextQueuedRun(socket, sessionId)
    }
  }

  clearSessionHistory(sessionId: string): { deleted: number; hadMemoryState: boolean } {
    const deleted = clearSessionMessages(sessionId)
    const state = this.sessionMap.get(sessionId)
    const hadMemoryState = Boolean(state)
    const messagePageLimit = state?.messagePageLimit
    if (state) {
      state.abortController?.abort()
      if (state.isWorking && isBridgeRunSource(state.source)) {
        const profile = state.profile
        void this.bridge.interrupt(sessionId, 'Session cleared', profile)
          .catch(err => logger.warn(err, '[chat-run-socket] failed to interrupt bridge run while clearing session %s', sessionId))
      }
      state.messages = []
      state.messageTotal = 0
      state.messageLoadedCount = 0
      state.hasMoreBefore = false
      state.inputTokens = 0
      state.outputTokens = 0
      state.contextTokens = 0
      state.events = []
      state.queue = []
      state.bridgePendingAssistantContent = undefined
      state.bridgePendingReasoningContent = undefined
      state.bridgePendingToolCallMarkup = undefined
      state.bridgeOutput = undefined
      state.bridgePendingTools = undefined
      state.bridgeCompressionResults = undefined
      state.responseRun = undefined
      state.activeRunMarker = undefined
      state.runId = undefined
      state.abortController = undefined
      state.isAborting = false
      state.isWorking = false
      state.profile = undefined
      this.sessionMap.delete(sessionId)
    }
    this.nsp.emit('session.command', {
      event: 'session.command',
      session_id: sessionId,
      command: 'clear',
      ok: true,
      action: 'clear',
      clearHistory: true,
      source: 'mcu',
      deleted,
      memory_cleared: hadMemoryState,
    })
    this.nsp.emit('resumed', {
      session_id: sessionId,
      messages: [],
      messageTotal: 0,
      messageLoadedCount: 0,
      messagePageLimit,
      hasMoreBefore: false,
      isWorking: false,
      isAborting: false,
      events: [],
      inputTokens: 0,
      outputTokens: 0,
      contextTokens: 0,
      queueLength: 0,
      queueMessages: [],
    })
    this.nsp.emit('run.queued', {
      event: 'run.queued',
      session_id: sessionId,
      queue_length: 0,
      queued_messages: [],
    })
    logger.info({ sessionId, deleted, hadMemoryState }, '[chat-run-socket] cleared session history and memory state')
    return { deleted, hadMemoryState }
  }

  private socketForQueuedRun(sessionId: string, next?: QueuedRun): Socket | null {
    if (next?.originSocketId) {
      const origin = this.nsp.sockets.get(next.originSocketId)
      if (origin) return origin
    }
    const room = this.nsp.adapter.rooms.get(`session:${sessionId}`)
    if (room) {
      for (const socketId of room) {
        const socket = this.nsp.sockets.get(socketId)
        if (socket) return socket
      }
    }
    return this.nsp.sockets.values().next().value || null
  }

  private clearClarifyEventState(sessionId: string, clarifyId: string) {
    const state = this.sessionMap.get(sessionId)
    if (!state?.events.length) return

    const nextEvents = state.events.filter(({ event, data }) => {
      if (event !== 'clarify.requested' && event !== 'clarify.resolved') return true
      return data?.clarify_id !== clarifyId
    })
    if (nextEvents.length !== state.events.length) {
      state.events = nextEvents
    }
  }

  private emitToSession(socket: Socket, sessionId: string, event: string, payload: any) {
    const tagged = { ...payload, session_id: sessionId }
    this.nsp.to(`session:${sessionId}`).emit(event, tagged)
    if (!this.nsp.adapter.rooms.get(`session:${sessionId}`)?.size && socket.connected) {
      socket.emit(event, tagged)
    }
  }

  private serializeQueuedMessages(queue: QueuedRun[]) {
    return queue.filter(item => item.displayInput !== null).map(item => ({
      id: item.queue_id,
      role: item.displayRole || (typeof item.displayInput === 'string' && item.displayInput.trim().startsWith('/') ? 'command' : 'user'),
      content: contentBlocksToString(item.displayInput ?? item.input),
      timestamp: Math.floor(Date.now() / 1000),
      queued: true,
    }))
  }

  private canAccessProfile(user: AuthenticatedUser, profile: string): boolean {
    return user.role === 'super_admin' || userCanAccessProfile(user.id, profile)
  }

  private canAccessSession(
    user: AuthenticatedUser | undefined,
    session?: { user_id?: string | number | null; profile?: string | null } | null,
    requestedUserId?: string | number | null,
  ): boolean {
    if (!session) return true
    if (!canAccessOwnedRecordWithContext(user, session, requestedUserId)) return false
    return !user || this.canAccessProfile(user, session.profile || 'default')
  }

  private getAccessibleStoredSession(
    user: AuthenticatedUser | undefined,
    sessionId: string,
    requestedUserId?: string | number | null,
  ) {
    const trimmedSessionId = String(sessionId || '').trim()
    if (!trimmedSessionId) return null
    const session = getSession(trimmedSessionId)
    if (session && !this.canAccessSession(user, session, requestedUserId)) {
      throw new Error('Session access denied')
    }
    return session
  }

  /** Close all active upstream response streams */
  close() {
    for (const [sessionId, state] of this.sessionMap.entries()) {
      if (state.abortController) {
        try {
          state.abortController.abort()
        } catch (e) {
          logger.warn(e, '[chat-run-socket] failed to abort controller for session %s', sessionId)
        }
      }
    }
    this.sessionMap.clear()
    logger.info('[chat-run-socket] closed all connections and cleared state')
  }
}
