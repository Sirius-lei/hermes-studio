import { resolveAvailableModelForProfile } from '../controllers/hermes/models'

export interface TaskPlannerAgentCandidate {
  id: string
  name: string
  description?: string
  baseUrl?: string
  skills?: Array<{ name?: string; description?: string }>
  tools?: Array<{ name?: string; description?: string }>
}

export interface TaskPlanTask {
  id: string
  phase: string
  title: string
  description: string
  status: 'draft' | 'confirmed' | 'exported'
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

export interface GeneratedTaskPlan {
  title: string
  summary: string
  plan: TaskPlanDocument
  planner_provider: string
  planner_model: string
}

interface RawPlannerResponse {
  title?: unknown
  summary?: unknown
  tasks?: unknown
  dependencies?: unknown
  agent_routes?: unknown
  risks?: unknown
  acceptance_criteria?: unknown
}

function trimString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item || '').trim()).filter(Boolean)
}

function normalizeTaskId(value: unknown, index: number): string {
  const raw = trimString(value)
  return raw || `T${index + 1}`
}

function normalizeConfidence(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 0.5
  if (numeric > 1) return Math.max(0, Math.min(1, numeric / 100))
  return Math.max(0, Math.min(1, numeric))
}

function normalizePlannerResponse(raw: RawPlannerResponse, requirement: string): {
  title: string
  summary: string
  plan: TaskPlanDocument
} {
  const rawTasks = Array.isArray(raw.tasks) ? raw.tasks as Array<Record<string, unknown>> : []
  if (rawTasks.length === 0) throw new Error('Planner returned no tasks')

  const tasks = rawTasks.slice(0, 20).map((task, index): TaskPlanTask => {
    const id = normalizeTaskId(task.id ?? task.task_id, index)
    const recommendedAgentId = trimString(task.recommended_agent_id ?? task.agent_id) || null
    const recommendedAgentName = trimString(task.recommended_agent_name ?? task.agent_name) || null
    return {
      id,
      phase: trimString(task.phase, `阶段 ${index + 1}`),
      title: trimString(task.title, `任务 ${index + 1}`),
      description: trimString(task.description ?? task.body, ''),
      status: 'draft',
      recommended_agent_id: recommendedAgentId,
      recommended_agent_name: recommendedAgentName,
      dependencies: stringArray(task.dependencies),
      acceptance_criteria: stringArray(task.acceptance_criteria ?? task.acceptance),
    }
  })
  const taskIds = new Set(tasks.map(task => task.id))

  const rawDependencies = Array.isArray(raw.dependencies) ? raw.dependencies as Array<Record<string, unknown>> : []
  const dependencies: TaskPlanDependency[] = rawDependencies
    .map((item): TaskPlanDependency | null => {
      const from = trimString(item.from ?? item.source ?? item.parent)
      const to = trimString(item.to ?? item.target ?? item.child)
      if (!taskIds.has(from) || !taskIds.has(to) || from === to) return null
      const type = item.type === 'informs' ? 'informs' : 'blocks'
      return { from, to, type }
    })
    .filter((item): item is TaskPlanDependency => Boolean(item))

  const dependencyKey = new Set(dependencies.map(item => `${item.from}->${item.to}`))
  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (!taskIds.has(dep) || dep === task.id) continue
      const key = `${dep}->${task.id}`
      if (dependencyKey.has(key)) continue
      dependencyKey.add(key)
      dependencies.push({ from: dep, to: task.id, type: 'blocks' })
    }
  }

  const rawRoutes = Array.isArray(raw.agent_routes) ? raw.agent_routes as Array<Record<string, unknown>> : []
  const routesByTask = new Map<string, TaskPlanAgentRoute>()
  for (const route of rawRoutes) {
    const taskId = trimString(route.task_id ?? route.taskId)
    if (!taskIds.has(taskId)) continue
    routesByTask.set(taskId, {
      task_id: taskId,
      agent_id: trimString(route.agent_id ?? route.agentId) || null,
      agent_name: trimString(route.agent_name ?? route.agentName) || null,
      reason: trimString(route.reason, '由 Planner 推荐'),
      confidence: normalizeConfidence(route.confidence),
    })
  }
  for (const task of tasks) {
    if (routesByTask.has(task.id)) continue
    routesByTask.set(task.id, {
      task_id: task.id,
      agent_id: task.recommended_agent_id,
      agent_name: task.recommended_agent_name,
      reason: task.recommended_agent_name ? '根据任务说明和子智能体描述匹配' : '暂无匹配子智能体',
      confidence: task.recommended_agent_name ? 0.5 : 0,
    })
  }

  return {
    title: trimString(raw.title, requirement.slice(0, 48) || '任务规划'),
    summary: trimString(raw.summary, '已生成任务规划。'),
    plan: {
      tasks,
      dependencies,
      agent_routes: [...routesByTask.values()],
      risks: stringArray(raw.risks),
      acceptance_criteria: stringArray(raw.acceptance_criteria),
    },
  }
}

function extractJsonObject(text: string): RawPlannerResponse {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const candidate = fenced?.[1]?.trim() || trimmed
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1))
    }
    throw new Error('Planner did not return valid JSON')
  }
}

function chatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) throw new Error('Selected provider is missing base_url')
  if (normalized.endsWith('/chat/completions')) return normalized
  if (/\/v\d+$/i.test(normalized)) return `${normalized}/chat/completions`
  return `${normalized}/v1/chat/completions`
}

function agentCapabilitySummary(agents: TaskPlannerAgentCandidate[]): Array<Record<string, unknown>> {
  return agents.slice(0, 30).map(agent => ({
    id: agent.id,
    name: agent.name,
    description: agent.description || '',
    baseUrl: agent.baseUrl || '',
    skills: (agent.skills || []).slice(0, 12).map(skill => ({
      name: skill.name || '',
      description: skill.description || '',
    })),
    tools: (agent.tools || []).slice(0, 12).map(tool => ({
      name: tool.name || '',
      description: tool.description || '',
    })),
  }))
}

async function postPlannerRequest(input: {
  url: string
  apiKey: string
  body: unknown
  signal?: AbortSignal
}): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`

  const response = await fetch(input.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(input.body),
    signal: input.signal,
  })
  const text = await response.text()
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    data = { error: { message: text || `Provider returned HTTP ${response.status}` } }
  }
  if (!response.ok) {
    throw new Error(data?.error?.message || `Provider returned HTTP ${response.status}`)
  }
  return data
}

export async function generateTaskPlan(input: {
  profile: string
  requirement: string
  provider?: string | null
  model?: string | null
  agents?: TaskPlannerAgentCandidate[]
}): Promise<GeneratedTaskPlan> {
  const requirement = input.requirement.trim()
  if (!requirement) throw new Error('requirement is required')
  const modelConfig = await resolveAvailableModelForProfile({
    profile: input.profile,
    provider: input.provider,
    model: input.model,
  })
  const apiMode = modelConfig.api_mode || 'chat_completions'
  if (apiMode !== 'chat_completions') {
    throw new Error(`Planner currently supports chat_completions providers, got ${apiMode}`)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)
  try {
    const response = await postPlannerRequest({
      url: chatCompletionsUrl(modelConfig.base_url),
      apiKey: modelConfig.api_key,
      signal: controller.signal,
      body: {
        model: modelConfig.model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: [
              '你是 Hermes 通用任务规划器。',
              '你的职责是把用户需求拆解成可执行任务清单，并为每个任务推荐合适的子智能体。',
              '这不是编码专用流程，任务可以是业务、运营、资料整理、分析、流程执行或开发。',
              '只输出一个 JSON 对象，不要输出 Markdown、解释文字或代码块。',
              'JSON 字段必须包含 title, summary, tasks, dependencies, agent_routes, risks, acceptance_criteria。',
              'tasks 中每项必须包含 id, phase, title, description, dependencies, recommended_agent_id, recommended_agent_name, acceptance_criteria。',
              'dependencies 使用 {from,to,type}，type 只能是 blocks 或 informs。',
              'agent_routes 使用 {task_id,agent_id,agent_name,reason,confidence}，confidence 是 0 到 1。',
              '如果没有合适子智能体，agent_id 和 agent_name 用 null，并说明待分配。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: JSON.stringify({
              requirement,
              available_agents: agentCapabilitySummary(input.agents || []),
              constraints: {
                task_count: '3-8 preferred, max 12 unless necessary',
                first_version: 'planning only, do not assume automatic execution',
                language: 'Chinese for user-facing text',
              },
            }),
          },
        ],
      },
    })
    const content = response?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Planner returned an empty response')
    }
    const raw = extractJsonObject(content)
    const normalized = normalizePlannerResponse(raw, requirement)
    return {
      ...normalized,
      planner_provider: modelConfig.provider,
      planner_model: modelConfig.model,
    }
  } finally {
    clearTimeout(timer)
  }
}
