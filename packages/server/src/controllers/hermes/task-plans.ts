import type { Context } from 'koa'
import {
  createTaskPlan,
  deleteTaskPlan,
  getTaskPlan,
  listTaskPlans,
  updateTaskPlan,
  type TaskPlanRecord,
  type TaskPlanStatus,
} from '../../db/hermes/task-plan-store'
import { listUserProfiles } from '../../db/hermes/users-store'
import { generateTaskPlan, type TaskPlanDocument, type TaskPlannerAgentCandidate } from '../../services/task-planner'
import * as kanbanCli from '../../services/hermes/hermes-kanban'

const DEFAULT_PROFILE = 'default'
const MAX_REQUIREMENT_LENGTH = 20000
const MAX_AGENTS = 50

function bodyRecord(ctx: Context): Record<string, unknown> {
  const body = ctx.request.body
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function profileName(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_PROFILE
}

function requestedProfile(ctx: Context, body?: Record<string, unknown>): string {
  const stateProfile = ctx.state?.profile?.name || ''
  const bodyProfile = body && typeof body.profile === 'string' ? body.profile.trim() : ''
  const queryProfile = firstQueryValue(ctx.query.profile as string | string[] | undefined)?.trim() || ''
  return profileName(stateProfile || bodyProfile || queryProfile)
}

function allowedProfileSet(ctx: Context): Set<string> | null {
  const user = ctx.state?.user
  if (!user || user.role === 'super_admin') return null
  return new Set(listUserProfiles(user.id).map(profile => profile.profile_name))
}

function canAccessProfile(ctx: Context, profile: string | null | undefined): boolean {
  const allowed = allowedProfileSet(ctx)
  return !allowed || allowed.has(profileName(profile))
}

function denyProfileAccess(ctx: Context, profile: string | null | undefined): boolean {
  if (canAccessProfile(ctx, profile)) return false
  ctx.status = 403
  ctx.body = { error: `Profile "${profileName(profile)}" is not available for this user` }
  return true
}

function filterByAllowedProfiles(ctx: Context, plans: TaskPlanRecord[]): TaskPlanRecord[] {
  const allowed = allowedProfileSet(ctx)
  if (!allowed) return plans
  return plans.filter(plan => allowed.has(profileName(plan.profile)))
}

function requiredId(ctx: Context): string | null {
  const id = typeof ctx.params?.id === 'string' ? ctx.params.id.trim() : ''
  if (id) return id
  ctx.status = 400
  ctx.body = { error: 'id is required' }
  return null
}

function readPlanForUser(ctx: Context): TaskPlanRecord | null {
  const id = requiredId(ctx)
  if (!id) return null
  const plan = getTaskPlan(id)
  if (!plan) {
    ctx.status = 404
    ctx.body = { error: 'task plan not found' }
    return null
  }
  if (denyProfileAccess(ctx, plan.profile)) return null
  return plan
}

function optionalString(value: unknown, name: string): { value?: string; error?: string } {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'string') return { error: `${name} must be a string` }
  return { value }
}

function requiredNonEmptyString(value: unknown, name: string): { value?: string; error?: string } {
  if (typeof value !== 'string' || !value.trim()) return { error: `${name} is required` }
  return { value: value.trim() }
}

function optionalPlanStatus(value: unknown, name: string): { value?: TaskPlanStatus; error?: string } {
  if (value === undefined || value === null) return {}
  if (value === 'draft' || value === 'confirmed' || value === 'exported' || value === 'archived') {
    return { value }
  }
  return { error: `${name} must be draft, confirmed, exported, or archived` }
}

function optionalPlanJson(value: unknown, name: string): { value?: Record<string, unknown>; error?: string } {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) return { error: `${name} must be an object` }
  return { value: value as Record<string, unknown> }
}

function rejectBadRequest(ctx: Context, error?: string): boolean {
  if (!error) return false
  ctx.status = 400
  ctx.body = { error }
  return true
}

function normalizeAgents(value: unknown): TaskPlannerAgentCandidate[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_AGENTS).map((item, index) => {
    const raw = item && typeof item === 'object' ? item as Record<string, any> : {}
    return {
      id: String(raw.id || raw.name || `agent-${index + 1}`),
      name: String(raw.name || raw.id || `Agent ${index + 1}`),
      description: typeof raw.description === 'string' ? raw.description : '',
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
      skills: Array.isArray(raw.skills) ? raw.skills : [],
      tools: Array.isArray(raw.tools) ? raw.tools : [],
    }
  }).filter(agent => agent.id.trim() && agent.name.trim())
}

function taskPlanDocument(value: Record<string, unknown>): TaskPlanDocument {
  return {
    tasks: Array.isArray(value.tasks) ? value.tasks as any : [],
    dependencies: Array.isArray(value.dependencies) ? value.dependencies as any : [],
    agent_routes: Array.isArray(value.agent_routes) ? value.agent_routes as any : [],
    risks: Array.isArray(value.risks) ? value.risks as any : [],
    acceptance_criteria: Array.isArray(value.acceptance_criteria) ? value.acceptance_criteria as any : [],
  }
}

function kanbanBody(plan: TaskPlanRecord, task: TaskPlanDocument['tasks'][number], route?: TaskPlanDocument['agent_routes'][number]): string {
  const lines = [
    `Plan: ${plan.title}`,
    `Plan ID: ${plan.id}`,
    '',
    '## Task',
    task.description || task.title,
    '',
    '## Recommended Agent',
    route?.agent_name || task.recommended_agent_name || '待分配',
    route?.reason ? `Reason: ${route.reason}` : '',
    '',
    '## Dependencies',
    task.dependencies.length ? task.dependencies.join(', ') : 'None',
    '',
    '## Acceptance Criteria',
    ...(task.acceptance_criteria.length ? task.acceptance_criteria.map(item => `- ${item}`) : ['- 待人工补充验收标准']),
  ].filter(line => line !== '')
  return lines.join('\n')
}

export async function list(ctx: Context) {
  const profile = firstQueryValue(ctx.query.profile as string | string[] | undefined)?.trim() || ''
  if (profile && denyProfileAccess(ctx, profile)) return
  const plans = filterByAllowedProfiles(ctx, listTaskPlans(profile || null))
  ctx.body = { plans }
}

export async function get(ctx: Context) {
  const plan = readPlanForUser(ctx)
  if (!plan) return
  ctx.body = { plan }
}

export async function generate(ctx: Context) {
  const body = bodyRecord(ctx)
  const requirement = requiredNonEmptyString(body.requirement, 'requirement')
  const provider = optionalString(body.provider, 'provider')
  const model = optionalString(body.model, 'model')
  if (rejectBadRequest(ctx, requirement.error || provider.error || model.error)) return
  if (requirement.value!.length > MAX_REQUIREMENT_LENGTH) {
    ctx.status = 400
    ctx.body = { error: `requirement must be <= ${MAX_REQUIREMENT_LENGTH} characters` }
    return
  }
  const profile = requestedProfile(ctx, body)
  if (denyProfileAccess(ctx, profile)) return

  try {
    const generated = await generateTaskPlan({
      profile,
      requirement: requirement.value!,
      provider: provider.value,
      model: model.value,
      agents: normalizeAgents(body.agents),
    })
    const plan = createTaskPlan({
      profile,
      title: generated.title,
      requirement: requirement.value!,
      summary: generated.summary,
      planner_provider: generated.planner_provider,
      planner_model: generated.planner_model,
      plan_json: generated.plan as unknown as Record<string, unknown>,
    })
    ctx.body = { plan }
  } catch (err: any) {
    ctx.status = 500
    ctx.body = { error: err?.message || 'failed to generate task plan' }
  }
}

export async function update(ctx: Context) {
  const existing = readPlanForUser(ctx)
  if (!existing) return
  const body = bodyRecord(ctx)
  const title = optionalString(body.title, 'title')
  const requirement = optionalString(body.requirement, 'requirement')
  const summary = optionalString(body.summary, 'summary')
  const status = optionalPlanStatus(body.status, 'status')
  const planJson = optionalPlanJson(body.plan_json ?? body.plan, 'plan_json')
  if (rejectBadRequest(ctx, title.error || requirement.error || summary.error || status.error || planJson.error)) return

  const updated = updateTaskPlan(existing.id, {
    ...(title.value !== undefined ? { title: title.value } : {}),
    ...(requirement.value !== undefined ? { requirement: requirement.value } : {}),
    ...(summary.value !== undefined ? { summary: summary.value } : {}),
    ...(status.value !== undefined ? { status: status.value } : {}),
    ...(planJson.value !== undefined ? { plan_json: planJson.value } : {}),
  })
  ctx.body = { plan: updated }
}

export async function remove(ctx: Context) {
  const existing = readPlanForUser(ctx)
  if (!existing) return
  const deleted = deleteTaskPlan(existing.id)
  ctx.body = { ok: deleted }
}

export async function exportKanban(ctx: Context) {
  const existing = readPlanForUser(ctx)
  if (!existing) return
  const body = bodyRecord(ctx)
  const board = typeof body.board === 'string' && body.board.trim() ? body.board.trim() : 'default'
  const assignee = typeof body.assignee === 'string' && body.assignee.trim()
    ? body.assignee.trim()
    : requestedProfile(ctx, body)
  if (assignee && denyProfileAccess(ctx, assignee)) return
  const document = taskPlanDocument(existing.plan_json)
  const routes = new Map(document.agent_routes.map(route => [route.task_id, route]))
  const exported: Array<{ task_plan_task_id: string; kanban_task: unknown }> = []

  try {
    for (const task of document.tasks) {
      const route = routes.get(task.id)
      const kanbanTask = await kanbanCli.createTask(task.title, {
        board,
        body: kanbanBody(existing, task, route),
        assignee,
        priority: 0,
        triage: true,
      })
      exported.push({ task_plan_task_id: task.id, kanban_task: kanbanTask })
    }
    const nextPlan = {
      ...document,
      tasks: document.tasks.map(task => ({ ...task, status: 'exported' as const })),
    }
    const updated = updateTaskPlan(existing.id, {
      status: 'exported',
      plan_json: nextPlan as unknown as Record<string, unknown>,
    })
    ctx.body = { plan: updated, exported }
  } catch (err: any) {
    ctx.status = 500
    ctx.body = { error: err?.message || 'failed to export task plan to kanban', exported }
  }
}
