export const SUB_AGENT_STORAGE_KEY = 'hermes.subAgents.frontendDraft.v4'
export const SUB_AGENT_STORAGE_EVENT = 'hermes:subagents:updated'

const MAX_RECENT_INVOCATIONS = 12

interface StoredSubAgentStats {
  completedCount?: number
  successCount?: number
  totalDurationMs?: number
}

export interface StoredSubAgentInvocationRecord {
  id: string
  status: 'running' | 'completed' | 'failed'
  task: string
  summary: string
  startedAt: number
  finishedAt?: number | null
  durationMs?: number | null
  sessionId?: string
  runId?: string
}

export interface StoredSubAgentRecordLike {
  id?: string
  name?: string
  callCount?: number
  successRate?: number
  avgLatencyMs?: number
  lastRun?: string
  recentInvocations?: StoredSubAgentInvocationRecord[]
  runtimeStats?: StoredSubAgentStats
  [key: string]: unknown
}

function hasWindow() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function trimmedLower(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function dispatchStoredSubAgentsUpdated() {
  if (!hasWindow()) return
  window.dispatchEvent(new CustomEvent(SUB_AGENT_STORAGE_EVENT))
}

export function readStoredSubAgents<T extends Record<string, unknown> = Record<string, unknown>>(): T[] {
  if (!hasWindow()) return []
  try {
    const raw = window.localStorage.getItem(SUB_AGENT_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

export function writeStoredSubAgents<T extends Record<string, unknown>>(records: T[], options: { notify?: boolean } = {}) {
  if (!hasWindow()) return
  window.localStorage.setItem(SUB_AGENT_STORAGE_KEY, JSON.stringify(records))
  if (options.notify !== false) {
    dispatchStoredSubAgentsUpdated()
  }
}

export function mutateStoredSubAgents<T extends Record<string, unknown> = Record<string, unknown>>(
  mutator: (records: T[]) => T[],
): T[] {
  const current = readStoredSubAgents<T>()
  const next = mutator([...current])
  writeStoredSubAgents(next, { notify: true })
  return next
}

function invocationKey(input: {
  sessionId: string
  runId?: string
  agentId?: string
  agentName?: string
}) {
  return [
    input.sessionId.trim(),
    String(input.runId || '').trim(),
    String(input.agentId || input.agentName || '').trim(),
  ].filter(Boolean).join(':')
}

function findStoredAgentIndex(records: StoredSubAgentRecordLike[], input: {
  agentId?: string
  agentName?: string
}) {
  const targetId = trimmedLower(input.agentId)
  const targetName = trimmedLower(input.agentName)
  return records.findIndex((record) => {
    if (targetId && trimmedLower(record.id) === targetId) return true
    return Boolean(targetName) && trimmedLower(record.name) === targetName
  })
}

function withComputedMetrics(record: StoredSubAgentRecordLike): StoredSubAgentRecordLike {
  const stats = record.runtimeStats || {}
  const completedCount = Math.max(0, Number(stats.completedCount || 0))
  const successCount = Math.max(0, Number(stats.successCount || 0))
  const totalDurationMs = Math.max(0, Number(stats.totalDurationMs || 0))
  return {
    ...record,
    runtimeStats: {
      completedCount,
      successCount,
      totalDurationMs,
    },
    successRate: completedCount > 0 ? Math.round((successCount / completedCount) * 100) : 0,
    avgLatencyMs: completedCount > 0 ? Math.round(totalDurationMs / completedCount) : 0,
  }
}

export function recordSubAgentInvocationStart(input: {
  sessionId: string
  runId?: string
  agentId?: string
  agentName?: string
  task?: string
}) {
  const task = String(input.task || '').trim()
  if (!input.sessionId.trim()) return

  mutateStoredSubAgents<StoredSubAgentRecordLike>((records) => {
    const index = findStoredAgentIndex(records, input)
    if (index < 0) return records

    const record = records[index]
    const invocationId = invocationKey(input)
    const recentInvocations = Array.isArray(record.recentInvocations)
      ? [...record.recentInvocations]
      : []
    const existing = recentInvocations.find(item => item.id === invocationId)
    if (!existing) {
      recentInvocations.unshift({
        id: invocationId,
        status: 'running',
        task,
        summary: task,
        startedAt: Date.now(),
        sessionId: input.sessionId,
        runId: input.runId,
      })
    }
    records[index] = {
      ...record,
      callCount: Number(record.callCount || 0) + (existing ? 0 : 1),
      lastRun: task || '子智能体执行中',
      recentInvocations: recentInvocations.slice(0, MAX_RECENT_INVOCATIONS),
    }
    return records
  })
}

export function recordSubAgentInvocationComplete(input: {
  sessionId: string
  runId?: string
  agentId?: string
  agentName?: string
  status: 'completed' | 'failed'
  summary?: string
  durationSeconds?: number
}) {
  if (!input.sessionId.trim()) return

  mutateStoredSubAgents<StoredSubAgentRecordLike>((records) => {
    const index = findStoredAgentIndex(records, input)
    if (index < 0) return records

    const record = records[index]
    const invocationId = invocationKey(input)
    const durationMs = Number.isFinite(input.durationSeconds)
      ? Math.max(0, Math.round(Number(input.durationSeconds) * 1000))
      : null
    const summary = String(input.summary || '').trim()
    const recentInvocations: StoredSubAgentInvocationRecord[] = Array.isArray(record.recentInvocations)
      ? [...record.recentInvocations as StoredSubAgentInvocationRecord[]]
      : []
    const existingIndex = recentInvocations.findIndex(item => item.id === invocationId)
    const existing: StoredSubAgentInvocationRecord | null = existingIndex >= 0 ? recentInvocations[existingIndex] : null

    if (existingIndex >= 0) {
      const current = existing as StoredSubAgentInvocationRecord
      recentInvocations[existingIndex] = {
        id: current.id,
        status: input.status,
        task: current.task,
        summary: summary || current.summary || current.task || '',
        startedAt: current.startedAt,
        finishedAt: current.finishedAt || Date.now(),
        durationMs: durationMs ?? current.durationMs ?? null,
        sessionId: current.sessionId,
        runId: current.runId,
      }
    } else {
      recentInvocations.unshift({
        id: invocationId,
        status: input.status,
        task: '',
        summary,
        startedAt: Date.now(),
        finishedAt: Date.now(),
        durationMs,
        sessionId: input.sessionId,
        runId: input.runId,
      })
    }

    const runtimeStats = {
      ...(record.runtimeStats || {}),
    }
    const alreadyFinished = Boolean(existing?.finishedAt)
    if (!alreadyFinished) {
      runtimeStats.completedCount = Number(runtimeStats.completedCount || 0) + 1
      if (input.status === 'completed') {
        runtimeStats.successCount = Number(runtimeStats.successCount || 0) + 1
      }
      if (durationMs !== null) {
        runtimeStats.totalDurationMs = Number(runtimeStats.totalDurationMs || 0) + durationMs
      }
    }

    records[index] = withComputedMetrics({
      ...record,
      runtimeStats,
      recentInvocations: recentInvocations.slice(0, MAX_RECENT_INVOCATIONS),
      lastRun: input.status === 'completed'
        ? (summary || '最近一次执行成功')
        : (summary || '最近一次执行失败'),
    })
    return records
  })
}
