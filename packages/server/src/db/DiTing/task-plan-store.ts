import { randomUUID } from 'crypto'
import { getDb, jsonDelete, jsonGet, jsonGetAll, jsonSet } from '../index'
import { TASK_PLANS_TABLE } from './schemas'

export type TaskPlanStatus = 'draft' | 'confirmed' | 'exported' | 'archived'

export interface TaskPlanRecord {
  id: string
  profile: string
  title: string
  requirement: string
  summary: string
  status: TaskPlanStatus
  planner_provider: string
  planner_model: string
  plan_json: Record<string, unknown>
  created_at: number
  updated_at: number
}

export interface TaskPlanCreateInput {
  id?: string
  profile?: string | null
  title: string
  requirement: string
  summary?: string | null
  status?: TaskPlanStatus | null
  planner_provider?: string | null
  planner_model?: string | null
  plan_json?: Record<string, unknown> | null
}

export interface TaskPlanUpdateInput {
  title?: string
  requirement?: string
  summary?: string
  status?: TaskPlanStatus
  planner_provider?: string
  planner_model?: string
  plan_json?: Record<string, unknown>
}

interface TaskPlanRow {
  id: string
  profile: string
  title: string
  requirement: string
  summary: string
  status: string
  planner_provider: string
  planner_model: string
  plan_json: string
  created_at: number
  updated_at: number
}

function profileName(value?: string | null): string {
  return value?.trim() || 'default'
}

function parsePlanJson(value: unknown): Record<string, unknown> {
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

function normalizeStatus(value: unknown): TaskPlanStatus {
  return value === 'confirmed' || value === 'exported' || value === 'archived' ? value : 'draft'
}

function rowToRecord(row: TaskPlanRow | Record<string, any>): TaskPlanRecord {
  const raw = row as Record<string, any>
  return {
    id: String(raw.id || ''),
    profile: profileName(raw.profile),
    title: String(raw.title || ''),
    requirement: String(raw.requirement || ''),
    summary: String(raw.summary || ''),
    status: normalizeStatus(raw.status),
    planner_provider: String(raw.planner_provider || ''),
    planner_model: String(raw.planner_model || ''),
    plan_json: parsePlanJson(raw.plan_json),
    created_at: Number(raw.created_at || 0),
    updated_at: Number(raw.updated_at || 0),
  }
}

function recordToRow(record: TaskPlanRecord): TaskPlanRow {
  return {
    id: record.id,
    profile: profileName(record.profile),
    title: record.title,
    requirement: record.requirement,
    summary: record.summary,
    status: record.status,
    planner_provider: record.planner_provider,
    planner_model: record.planner_model,
    plan_json: JSON.stringify(record.plan_json || {}),
    created_at: record.created_at,
    updated_at: record.updated_at,
  }
}

export function listTaskPlans(profile?: string | null): TaskPlanRecord[] {
  const db = getDb()
  const normalizedProfile = profile ? profileName(profile) : null
  if (!db) {
    return Object.values(jsonGetAll(TASK_PLANS_TABLE))
      .map(rowToRecord)
      .filter(plan => !normalizedProfile || plan.profile === normalizedProfile)
      .sort((a, b) => b.updated_at - a.updated_at)
  }

  const rows = normalizedProfile
    ? db.prepare(`SELECT * FROM ${TASK_PLANS_TABLE} WHERE profile = ? ORDER BY updated_at DESC`).all(normalizedProfile)
    : db.prepare(`SELECT * FROM ${TASK_PLANS_TABLE} ORDER BY updated_at DESC`).all()
  return (rows as unknown as TaskPlanRow[]).map(rowToRecord)
}

export function getTaskPlan(id: string): TaskPlanRecord | null {
  const db = getDb()
  if (!db) {
    const row = jsonGet(TASK_PLANS_TABLE, id)
    return row ? rowToRecord(row) : null
  }

  const row = db.prepare(`SELECT * FROM ${TASK_PLANS_TABLE} WHERE id = ?`).get(id) as TaskPlanRow | undefined
  return row ? rowToRecord(row) : null
}

export function createTaskPlan(input: TaskPlanCreateInput): TaskPlanRecord {
  const now = Date.now()
  const record: TaskPlanRecord = {
    id: input.id?.trim() || randomUUID(),
    profile: profileName(input.profile),
    title: input.title.trim(),
    requirement: input.requirement.trim(),
    summary: input.summary?.trim() || '',
    status: normalizeStatus(input.status),
    planner_provider: input.planner_provider?.trim() || '',
    planner_model: input.planner_model?.trim() || '',
    plan_json: input.plan_json || {},
    created_at: now,
    updated_at: now,
  }
  const row = recordToRow(record)
  const db = getDb()
  if (!db) {
    jsonSet(TASK_PLANS_TABLE, record.id, row as any)
    return record
  }

  db.prepare(`
    INSERT INTO ${TASK_PLANS_TABLE} (
      id, profile, title, requirement, summary, status, planner_provider, planner_model,
      plan_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.profile,
    row.title,
    row.requirement,
    row.summary,
    row.status,
    row.planner_provider,
    row.planner_model,
    row.plan_json,
    row.created_at,
    row.updated_at,
  )
  return record
}

export function updateTaskPlan(id: string, input: TaskPlanUpdateInput): TaskPlanRecord | null {
  const existing = getTaskPlan(id)
  if (!existing) return null

  const next: TaskPlanRecord = {
    ...existing,
    title: input.title === undefined ? existing.title : input.title.trim(),
    requirement: input.requirement === undefined ? existing.requirement : input.requirement.trim(),
    summary: input.summary === undefined ? existing.summary : input.summary.trim(),
    status: input.status === undefined ? existing.status : normalizeStatus(input.status),
    planner_provider: input.planner_provider === undefined ? existing.planner_provider : input.planner_provider.trim(),
    planner_model: input.planner_model === undefined ? existing.planner_model : input.planner_model.trim(),
    plan_json: input.plan_json === undefined ? existing.plan_json : input.plan_json,
    updated_at: Date.now(),
  }
  const row = recordToRow(next)
  const db = getDb()
  if (!db) {
    jsonSet(TASK_PLANS_TABLE, id, row as any)
    return next
  }

  db.prepare(`
    UPDATE ${TASK_PLANS_TABLE}
    SET title = ?, requirement = ?, summary = ?, status = ?, planner_provider = ?,
      planner_model = ?, plan_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    row.title,
    row.requirement,
    row.summary,
    row.status,
    row.planner_provider,
    row.planner_model,
    row.plan_json,
    row.updated_at,
    id,
  )
  return next
}

export function deleteTaskPlan(id: string): boolean {
  const existing = getTaskPlan(id)
  if (!existing) return false
  const db = getDb()
  if (!db) {
    jsonDelete(TASK_PLANS_TABLE, id)
    return true
  }
  const result = db.prepare(`DELETE FROM ${TASK_PLANS_TABLE} WHERE id = ?`).run(id)
  return Number(result.changes || 0) > 0
}
