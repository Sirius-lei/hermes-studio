import { request } from '../client'

export type TaskPlanStatus = 'draft' | 'confirmed' | 'exported' | 'archived'
export type TaskPlanTaskStatus = 'draft' | 'confirmed' | 'exported'

export interface TaskPlanTask {
  id: string
  phase: string
  title: string
  description: string
  status: TaskPlanTaskStatus
  recommended_agent_id: string | null
  recommended_agent_name: string | null
  dependencies: string[]
  acceptance_criteria: string[]
}

export interface TaskPlanDependency {
  from: string
  to: string
  type: 'blocks' | 'informs'
}

export interface TaskPlanAgentRoute {
  task_id: string
  agent_id: string | null
  agent_name: string | null
  reason: string
  confidence: number
}

export interface TaskPlanDocument {
  tasks: TaskPlanTask[]
  dependencies: TaskPlanDependency[]
  agent_routes: TaskPlanAgentRoute[]
  risks: string[]
  acceptance_criteria: string[]
}

export interface TaskPlanRecord {
  id: string
  profile: string
  title: string
  requirement: string
  summary: string
  status: TaskPlanStatus
  planner_provider: string
  planner_model: string
  plan_json: TaskPlanDocument
  created_at: number
  updated_at: number
}

export interface TaskPlanAgentCandidate {
  id: string
  name: string
  description?: string
  baseUrl?: string
  skills?: Array<{ name?: string; description?: string }>
  tools?: Array<{ name?: string; description?: string }>
}

export interface GenerateTaskPlanRequest {
  requirement: string
  provider?: string
  model?: string
  agents?: TaskPlanAgentCandidate[]
}

export interface UpdateTaskPlanRequest {
  title?: string
  requirement?: string
  summary?: string
  status?: TaskPlanStatus
  plan?: TaskPlanDocument
}

export interface ExportTaskPlanRequest {
  board?: string
  assignee?: string
}

export async function listTaskPlans(): Promise<TaskPlanRecord[]> {
  const res = await request<{ plans: TaskPlanRecord[] }>('/api/hermes/task-plans')
  return res.plans
}

export async function getTaskPlan(id: string): Promise<TaskPlanRecord> {
  const res = await request<{ plan: TaskPlanRecord }>(`/api/hermes/task-plans/${encodeURIComponent(id)}`)
  return res.plan
}

export async function generateTaskPlan(data: GenerateTaskPlanRequest): Promise<TaskPlanRecord> {
  const res = await request<{ plan: TaskPlanRecord }>('/api/hermes/task-plans/generate', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return res.plan
}

export async function updateTaskPlan(id: string, data: UpdateTaskPlanRequest): Promise<TaskPlanRecord> {
  const res = await request<{ plan: TaskPlanRecord }>(`/api/hermes/task-plans/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
  return res.plan
}

export async function deleteTaskPlan(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/hermes/task-plans/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function exportTaskPlanToKanban(id: string, data: ExportTaskPlanRequest = {}): Promise<{
  plan: TaskPlanRecord
  exported: Array<{ task_plan_task_id: string; kanban_task: unknown }>
}> {
  return request(`/api/hermes/task-plans/${encodeURIComponent(id)}/export-kanban`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
