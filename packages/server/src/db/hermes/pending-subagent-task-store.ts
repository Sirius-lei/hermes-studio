import { getDb, jsonDelete, jsonGet, jsonGetAll, jsonSet } from '../index'
import { PENDING_SUBAGENT_TASKS_TABLE } from './schemas'

export type PendingSubagentTaskStatus = 'clarify_required'

export interface PendingSubagentTaskClarification {
  question: string
  reason: string
  required_fields: string[]
  acceptable_any_of: boolean
}

interface PendingSubagentTaskClarificationInput extends Partial<PendingSubagentTaskClarification> {
  requiredFields?: string[]
  acceptableAnyOf?: boolean
}

export interface PendingSubagentTaskRecord {
  session_id: string
  task_id: string
  collaboration_run_id: string | null
  profile: string
  node_id: string
  agent_id: string
  agent_name: string
  status: PendingSubagentTaskStatus
  objective: string
  question: string
  required_fields: string[]
  clarification: PendingSubagentTaskClarification
  route_decision_json: Record<string, unknown>
  result_json: Record<string, unknown>
  last_result_summary: string
  last_visible_output: string
  created_at: number
  updated_at: number
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function nullableStringValue(value: unknown): string | null {
  const normalized = stringValue(value).trim()
  return normalized || null
}

function profileName(value?: unknown): string {
  return stringValue(value).trim() || 'default'
}

function parseArrayJson(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean)
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(item => String(item || '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function parseObjectJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function normalizeClarification(value: unknown): PendingSubagentTaskClarification {
  const raw = parseObjectJson(value)
  return {
    question: stringValue(raw.question).trim(),
    reason: stringValue(raw.reason).trim(),
    required_fields: parseArrayJson(raw.required_fields ?? raw.requiredFields),
    acceptable_any_of: raw.acceptable_any_of === true || raw.acceptableAnyOf === true,
  }
}

function rowToRecord(row: Record<string, unknown>): PendingSubagentTaskRecord {
  const clarification = normalizeClarification(row.clarification_json)
  const requiredFields = parseArrayJson(row.required_fields_json)
  return {
    session_id: stringValue(row.session_id).trim(),
    task_id: stringValue(row.task_id).trim(),
    collaboration_run_id: nullableStringValue(row.collaboration_run_id),
    profile: profileName(row.profile),
    node_id: stringValue(row.node_id).trim(),
    agent_id: stringValue(row.agent_id).trim(),
    agent_name: stringValue(row.agent_name).trim(),
    status: 'clarify_required',
    objective: stringValue(row.objective).trim(),
    question: stringValue(row.question).trim(),
    required_fields: requiredFields,
    clarification: {
      ...clarification,
      question: clarification.question || stringValue(row.question).trim(),
      required_fields: clarification.required_fields.length > 0 ? clarification.required_fields : requiredFields,
    },
    route_decision_json: parseObjectJson(row.route_decision_json),
    result_json: parseObjectJson(row.result_json),
    last_result_summary: stringValue(row.last_result_summary).trim(),
    last_visible_output: stringValue(row.last_visible_output).trim(),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  }
}

function recordToRow(record: PendingSubagentTaskRecord) {
  return {
    session_id: record.session_id,
    task_id: record.task_id,
    collaboration_run_id: record.collaboration_run_id,
    profile: record.profile,
    node_id: record.node_id,
    agent_id: record.agent_id,
    agent_name: record.agent_name,
    status: record.status,
    objective: record.objective,
    question: record.question,
    required_fields_json: JSON.stringify(record.required_fields || []),
    clarification_json: JSON.stringify(record.clarification || {}),
    route_decision_json: JSON.stringify(record.route_decision_json || {}),
    result_json: JSON.stringify(record.result_json || {}),
    last_result_summary: record.last_result_summary,
    last_visible_output: record.last_visible_output,
    created_at: record.created_at,
    updated_at: record.updated_at,
  }
}

export function getPendingSubagentTask(sessionId: string): PendingSubagentTaskRecord | null {
  const normalizedSessionId = String(sessionId || '').trim()
  if (!normalizedSessionId) return null
  const db = getDb()
  if (!db) {
    const row = jsonGet(PENDING_SUBAGENT_TASKS_TABLE, normalizedSessionId)
    return row ? rowToRecord(row) : null
  }
  const row = db.prepare(`SELECT * FROM ${PENDING_SUBAGENT_TASKS_TABLE} WHERE session_id = ?`).get(normalizedSessionId) as Record<string, unknown> | undefined
  return row ? rowToRecord(row) : null
}

export function upsertPendingSubagentTask(input: {
  session_id: string
  task_id: string
  collaboration_run_id?: string | null
  profile?: string | null
  node_id?: string
  agent_id?: string
  agent_name?: string
  objective?: string
  question?: string
  required_fields?: string[]
  clarification?: PendingSubagentTaskClarificationInput | null
  route_decision_json?: Record<string, unknown>
  result_json?: Record<string, unknown>
  last_result_summary?: string
  last_visible_output?: string
}): PendingSubagentTaskRecord {
  const existing = getPendingSubagentTask(input.session_id)
  const now = Date.now()
  const requiredFields = Array.isArray(input.required_fields)
    ? input.required_fields.map(item => String(item || '').trim()).filter(Boolean)
    : existing?.required_fields || []
  const clarification: PendingSubagentTaskClarification = {
    question: String(input.clarification?.question ?? input.question ?? existing?.clarification.question ?? '').trim(),
    reason: String(input.clarification?.reason ?? existing?.clarification.reason ?? '').trim(),
    required_fields: Array.isArray(input.clarification?.required_fields)
      ? input.clarification!.required_fields!.map(item => String(item || '').trim()).filter(Boolean)
      : requiredFields,
    acceptable_any_of: input.clarification?.acceptable_any_of === true
      || input.clarification?.acceptableAnyOf === true
      || existing?.clarification.acceptable_any_of === true,
  }
  const record: PendingSubagentTaskRecord = {
    session_id: String(input.session_id || '').trim(),
    task_id: String(input.task_id || existing?.task_id || '').trim(),
    collaboration_run_id: input.collaboration_run_id === undefined
      ? (existing?.collaboration_run_id || null)
      : (input.collaboration_run_id ? String(input.collaboration_run_id).trim() : null),
    profile: profileName(input.profile || existing?.profile),
    node_id: String(input.node_id || existing?.node_id || '').trim(),
    agent_id: String(input.agent_id || existing?.agent_id || '').trim(),
    agent_name: String(input.agent_name || existing?.agent_name || '').trim(),
    status: 'clarify_required',
    objective: String(input.objective || existing?.objective || '').trim(),
    question: String(input.question || clarification.question || existing?.question || '').trim(),
    required_fields: clarification.required_fields,
    clarification,
    route_decision_json: input.route_decision_json || existing?.route_decision_json || {},
    result_json: input.result_json || existing?.result_json || {},
    last_result_summary: String(input.last_result_summary || existing?.last_result_summary || '').trim(),
    last_visible_output: String(input.last_visible_output || existing?.last_visible_output || '').trim(),
    created_at: existing?.created_at || now,
    updated_at: now,
  }

  const row = recordToRow(record)
  const db = getDb()
  if (!db) {
    jsonSet(PENDING_SUBAGENT_TASKS_TABLE, record.session_id, row as Record<string, unknown>)
    return record
  }
  db.prepare(`
    INSERT OR REPLACE INTO ${PENDING_SUBAGENT_TASKS_TABLE} (
      session_id, task_id, collaboration_run_id, profile, node_id, agent_id, agent_name,
      status, objective, question, required_fields_json, clarification_json,
      route_decision_json, result_json, last_result_summary, last_visible_output,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.session_id,
    row.task_id,
    row.collaboration_run_id,
    row.profile,
    row.node_id,
    row.agent_id,
    row.agent_name,
    row.status,
    row.objective,
    row.question,
    row.required_fields_json,
    row.clarification_json,
    row.route_decision_json,
    row.result_json,
    row.last_result_summary,
    row.last_visible_output,
    row.created_at,
    row.updated_at,
  )
  return record
}

export function deletePendingSubagentTask(sessionId: string): void {
  const normalizedSessionId = String(sessionId || '').trim()
  if (!normalizedSessionId) return
  const db = getDb()
  if (!db) {
    jsonDelete(PENDING_SUBAGENT_TASKS_TABLE, normalizedSessionId)
    return
  }
  db.prepare(`DELETE FROM ${PENDING_SUBAGENT_TASKS_TABLE} WHERE session_id = ?`).run(normalizedSessionId)
}

export function listPendingSubagentTasks(profile?: string | null): PendingSubagentTaskRecord[] {
  const normalizedProfile = profileName(profile)
  const db = getDb()
  if (!db) {
    return Object.values(jsonGetAll(PENDING_SUBAGENT_TASKS_TABLE))
      .map(row => rowToRecord(row))
      .filter(record => !profile || record.profile === normalizedProfile)
      .sort((a, b) => b.updated_at - a.updated_at)
  }
  const rows = db.prepare(
    profile
      ? `SELECT * FROM ${PENDING_SUBAGENT_TASKS_TABLE} WHERE profile = ? ORDER BY updated_at DESC`
      : `SELECT * FROM ${PENDING_SUBAGENT_TASKS_TABLE} ORDER BY updated_at DESC`,
  ).all(...(profile ? [normalizedProfile] : [])) as Array<Record<string, unknown>>
  return rows.map(row => rowToRecord(row))
}
