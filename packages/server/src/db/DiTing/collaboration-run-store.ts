import { randomUUID } from 'crypto'
import { getDb, jsonGet, jsonGetAll, jsonSet } from '../index'
import { COLLABORATION_RUNS_TABLE } from './schemas'

export type CollaborationRunStatus = 'running' | 'completed' | 'failed'

export interface CollaborationRunRecord {
  id: string
  session_id: string
  run_id: string | null
  user_id: string | null
  profile: string
  status: CollaborationRunStatus
  mode: string
  intent: string
  category: string
  reason: string
  text: string
  objective: string
  selected_agent_id: string
  selected_agent_name: string
  current_node_id: string | null
  route_json: Record<string, unknown>
  snapshot_json: Record<string, unknown>
  events_json: Array<Record<string, unknown>>
  error: string | null
  started_at: number
  ended_at: number | null
  updated_at: number
}

function profileName(value?: unknown): string {
  return String(value || '').trim() || 'default'
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function nullableStringValue(value: unknown): string | null {
  const normalized = stringValue(value).trim()
  return normalized || null
}

function parseObjectJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function parseArrayJson(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>>
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>>
      : []
  } catch {
    return []
  }
}

function rowToRecord(row: Record<string, unknown>): CollaborationRunRecord {
  return {
    id: stringValue(row.id),
    session_id: stringValue(row.session_id),
    run_id: nullableStringValue(row.run_id),
    user_id: nullableStringValue(row.user_id),
    profile: profileName(row.profile),
    status: (stringValue(row.status) || 'running') as CollaborationRunStatus,
    mode: stringValue(row.mode),
    intent: stringValue(row.intent),
    category: stringValue(row.category),
    reason: stringValue(row.reason),
    text: stringValue(row.text),
    objective: stringValue(row.objective),
    selected_agent_id: stringValue(row.selected_agent_id),
    selected_agent_name: stringValue(row.selected_agent_name),
    current_node_id: nullableStringValue(row.current_node_id),
    route_json: parseObjectJson(row.route_json),
    snapshot_json: parseObjectJson(row.snapshot_json),
    events_json: parseArrayJson(row.events_json),
    error: nullableStringValue(row.error),
    started_at: Number(row.started_at || 0),
    ended_at: row.ended_at == null ? null : Number(row.ended_at),
    updated_at: Number(row.updated_at || 0),
  }
}

function recordToRow(record: CollaborationRunRecord) {
  return {
    id: record.id,
    session_id: record.session_id,
    run_id: record.run_id,
    user_id: record.user_id,
    profile: record.profile,
    status: record.status,
    mode: record.mode,
    intent: record.intent,
    category: record.category,
    reason: record.reason,
    text: record.text,
    objective: record.objective,
    selected_agent_id: record.selected_agent_id,
    selected_agent_name: record.selected_agent_name,
    current_node_id: record.current_node_id,
    route_json: JSON.stringify(record.route_json || {}),
    snapshot_json: JSON.stringify(record.snapshot_json || {}),
    events_json: JSON.stringify(record.events_json || []),
    error: record.error,
    started_at: record.started_at,
    ended_at: record.ended_at,
    updated_at: record.updated_at,
  }
}

export function createCollaborationRun(input: {
  id?: string
  session_id: string
  run_id?: string | null
  user_id?: string | number | null
  profile?: string | null
  status?: CollaborationRunStatus
  mode?: string
  intent?: string
  category?: string
  reason?: string
  text?: string
  objective?: string
  selected_agent_id?: string
  selected_agent_name?: string
  current_node_id?: string | null
  route_json?: Record<string, unknown>
  snapshot_json?: Record<string, unknown>
  events_json?: Array<Record<string, unknown>>
  error?: string | null
  started_at?: number
  ended_at?: number | null
}): CollaborationRunRecord {
  const now = Date.now()
  const record: CollaborationRunRecord = {
    id: String(input.id || randomUUID()).trim(),
    session_id: String(input.session_id || '').trim(),
    run_id: nullableStringValue(input.run_id),
    user_id: input.user_id == null ? null : String(input.user_id),
    profile: profileName(input.profile),
    status: input.status || 'running',
    mode: stringValue(input.mode),
    intent: stringValue(input.intent),
    category: stringValue(input.category),
    reason: stringValue(input.reason),
    text: stringValue(input.text),
    objective: stringValue(input.objective),
    selected_agent_id: stringValue(input.selected_agent_id),
    selected_agent_name: stringValue(input.selected_agent_name),
    current_node_id: nullableStringValue(input.current_node_id),
    route_json: input.route_json || {},
    snapshot_json: input.snapshot_json || {},
    events_json: Array.isArray(input.events_json) ? input.events_json : [],
    error: nullableStringValue(input.error),
    started_at: Number(input.started_at || now),
    ended_at: input.ended_at == null ? null : Number(input.ended_at),
    updated_at: now,
  }
  const row = recordToRow(record)
  const db = getDb()
  if (!db) {
    jsonSet(COLLABORATION_RUNS_TABLE, record.id, row as Record<string, unknown>)
    return record
  }
  db.prepare(`
    INSERT INTO ${COLLABORATION_RUNS_TABLE} (
      id, session_id, run_id, user_id, profile, status, mode, intent, category,
      reason, text, objective, selected_agent_id, selected_agent_name, current_node_id,
      route_json, snapshot_json, events_json, error, started_at, ended_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.session_id,
    row.run_id,
    row.user_id,
    row.profile,
    row.status,
    row.mode,
    row.intent,
    row.category,
    row.reason,
    row.text,
    row.objective,
    row.selected_agent_id,
    row.selected_agent_name,
    row.current_node_id,
    row.route_json,
    row.snapshot_json,
    row.events_json,
    row.error,
    row.started_at,
    row.ended_at,
    row.updated_at,
  )
  return record
}

export function getCollaborationRun(id: string): CollaborationRunRecord | null {
  const db = getDb()
  if (!db) {
    const row = jsonGet(COLLABORATION_RUNS_TABLE, id)
    return row ? rowToRecord(row) : null
  }
  const row = db.prepare(`SELECT * FROM ${COLLABORATION_RUNS_TABLE} WHERE id = ?`).get(id) as Record<string, unknown> | undefined
  return row ? rowToRecord(row) : null
}

export function updateCollaborationRun(
  id: string,
  patch: Partial<Omit<CollaborationRunRecord, 'id' | 'session_id' | 'started_at'>> & {
    route_json?: Record<string, unknown>
    snapshot_json?: Record<string, unknown>
    events_json?: Array<Record<string, unknown>>
  },
): CollaborationRunRecord | null {
  const existing = getCollaborationRun(id)
  if (!existing) return null
  const next: CollaborationRunRecord = {
    ...existing,
    ...patch,
    run_id: patch.run_id === undefined ? existing.run_id : nullableStringValue(patch.run_id),
    user_id: patch.user_id === undefined ? existing.user_id : (patch.user_id == null ? null : String(patch.user_id)),
    profile: patch.profile === undefined ? existing.profile : profileName(patch.profile),
    mode: patch.mode === undefined ? existing.mode : stringValue(patch.mode),
    intent: patch.intent === undefined ? existing.intent : stringValue(patch.intent),
    category: patch.category === undefined ? existing.category : stringValue(patch.category),
    reason: patch.reason === undefined ? existing.reason : stringValue(patch.reason),
    text: patch.text === undefined ? existing.text : stringValue(patch.text),
    objective: patch.objective === undefined ? existing.objective : stringValue(patch.objective),
    selected_agent_id: patch.selected_agent_id === undefined ? existing.selected_agent_id : stringValue(patch.selected_agent_id),
    selected_agent_name: patch.selected_agent_name === undefined ? existing.selected_agent_name : stringValue(patch.selected_agent_name),
    current_node_id: patch.current_node_id === undefined ? existing.current_node_id : nullableStringValue(patch.current_node_id),
    route_json: patch.route_json === undefined ? existing.route_json : patch.route_json,
    snapshot_json: patch.snapshot_json === undefined ? existing.snapshot_json : patch.snapshot_json,
    events_json: patch.events_json === undefined ? existing.events_json : patch.events_json,
    error: patch.error === undefined ? existing.error : nullableStringValue(patch.error),
    ended_at: patch.ended_at === undefined ? existing.ended_at : (patch.ended_at == null ? null : Number(patch.ended_at)),
    updated_at: Date.now(),
  }
  const row = recordToRow(next)
  const db = getDb()
  if (!db) {
    jsonSet(COLLABORATION_RUNS_TABLE, id, row as Record<string, unknown>)
    return next
  }
  db.prepare(`
    UPDATE ${COLLABORATION_RUNS_TABLE}
    SET run_id = ?, user_id = ?, profile = ?, status = ?, mode = ?, intent = ?, category = ?,
        reason = ?, text = ?, objective = ?, selected_agent_id = ?, selected_agent_name = ?,
        current_node_id = ?, route_json = ?, snapshot_json = ?, events_json = ?, error = ?,
        ended_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    row.run_id,
    row.user_id,
    row.profile,
    row.status,
    row.mode,
    row.intent,
    row.category,
    row.reason,
    row.text,
    row.objective,
    row.selected_agent_id,
    row.selected_agent_name,
    row.current_node_id,
    row.route_json,
    row.snapshot_json,
    row.events_json,
    row.error,
    row.ended_at,
    row.updated_at,
    id,
  )
  return next
}

export function listSessionCollaborationRuns(sessionId: string, limit = 50): CollaborationRunRecord[] {
  const normalizedSessionId = String(sessionId || '').trim()
  if (!normalizedSessionId) return []
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit) || 50))
  const db = getDb()
  if (!db) {
    return Object.values(jsonGetAll(COLLABORATION_RUNS_TABLE))
      .map(rowToRecord)
      .filter(record => record.session_id === normalizedSessionId)
      .sort((left, right) => right.started_at - left.started_at)
      .slice(0, safeLimit)
  }
  const rows = db.prepare(`
    SELECT * FROM ${COLLABORATION_RUNS_TABLE}
    WHERE session_id = ?
    ORDER BY started_at DESC, updated_at DESC
    LIMIT ?
  `).all(normalizedSessionId, safeLimit) as Record<string, unknown>[]
  return rows.map(rowToRecord)
}

export function latestSessionCollaborationRun(sessionId: string): CollaborationRunRecord | null {
  const [latest] = listSessionCollaborationRuns(sessionId, 1)
  return latest || null
}
