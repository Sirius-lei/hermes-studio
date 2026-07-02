import {
  generateTaskPlan,
  generateTaskRouteDecision,
  streamTaskRouteReasoning,
  type GeneratedTaskPlan,
  type GeneratedTaskRouteDecision,
  type TaskPlanAgentRoute,
  type TaskPlanTask,
} from '../../task-planner'
import { contentBlocksToString, extractTextForPreview } from './content-blocks'
import type { ContentBlock } from './types'

export interface MultiAgentRouteSkillRef {
  name?: string
  description?: string
}

export interface MultiAgentRouteCandidate {
  id: string
  name: string
  description?: string
  baseUrl?: string
  chatPath?: string
  enabled?: boolean
  skills?: MultiAgentRouteSkillRef[]
  tools?: MultiAgentRouteSkillRef[]
}

export interface MultiAgentPlanNodeExecutor {
  type: 'hermes' | 'subagent'
  id?: string
  name: string
}

export interface MultiAgentPlanNode {
  id: string
  title: string
  phase: string
  status: 'todo' | 'doing' | 'done' | 'blocked'
  executor: MultiAgentPlanNodeExecutor
  summary: string
}

export interface MultiAgentExecutionPlan {
  objective: string
  status: 'idle' | 'running' | 'completed' | 'failed'
  currentNodeId: string | null
  nodes: MultiAgentPlanNode[]
}

export interface MultiAgentRouteDecision {
  enabled: boolean
  shouldPlan: boolean
  summary: string
  intent: string
  category: string
  confidence: number
  reason: string
  executionMode: 'delegate_subagent' | 'hermes_native'
  selectedAgent: MultiAgentRouteCandidate | null
  routeText: string
  hermesInstructions: string | null
  inputText: string
  todo: string[]
  constraints: string[]
  plan: MultiAgentExecutionPlan | null
  delegatedNodeIds: string[]
}

export interface MultiAgentRouteProgressEvent {
  stage: 'understand' | 'route' | 'match_agents'
  status: 'running' | 'done'
  text: string
}

export interface MultiAgentRouteReasoningEvent {
  stage: 'understand' | 'route' | 'match_agents'
  text: string
}

function uniqueTerms(values: string[]) {
  return [...new Set(values.map(value => value.trim().toLowerCase()).filter(Boolean))]
}

function normalizeKey(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function extractIntentTerms(text: string) {
  const terms = new Set<string>()
  const normalized = text.trim().toLowerCase()

  for (const match of normalized.match(/[a-z0-9_/-]{2,}/g) || []) {
    terms.add(match)
  }

  for (const chunk of text.match(/[\u4e00-\u9fff]{2,12}/g) || []) {
    terms.add(chunk)
    const maxSize = Math.min(4, chunk.length)
    for (let size = 2; size <= maxSize; size += 1) {
      for (let index = 0; index <= chunk.length - size; index += 1) {
        terms.add(chunk.slice(index, index + size))
      }
    }
  }

  return [...terms]
}

function candidateText(agent: MultiAgentRouteCandidate): string {
  return [
    agent.name,
    agent.description || '',
    ...(agent.skills || []).flatMap(skill => [skill.name || '', skill.description || '']),
    ...(agent.tools || []).flatMap(tool => [tool.name || '', tool.description || '']),
  ].join(' ').toLowerCase()
}

function scoreCandidate(agent: MultiAgentRouteCandidate, terms: string[]) {
  const name = agent.name.toLowerCase()
  const description = String(agent.description || '').toLowerCase()
  const skills = (agent.skills || []).map(skill => `${skill.name || ''} ${skill.description || ''}`.toLowerCase()).join(' ')
  const tools = (agent.tools || []).map(tool => `${tool.name || ''} ${tool.description || ''}`.toLowerCase()).join(' ')

  let score = 0
  for (const term of uniqueTerms(terms)) {
    if (term.length < 2) continue
    if (name.includes(term)) {
      score += 6
      continue
    }
    if (skills.includes(term)) {
      score += 4
      continue
    }
    if (description.includes(term)) {
      score += 3
      continue
    }
    if (tools.includes(term)) {
      score += 2
    }
  }
  return score
}

function chooseCandidate(agents: MultiAgentRouteCandidate[], terms: string[]) {
  let best: { agent: MultiAgentRouteCandidate; score: number } | null = null
  for (const agent of agents) {
    const score = scoreCandidate(agent, terms)
    if (!best || score > best.score) best = { agent, score }
  }
  return best && best.score > 0 ? best : null
}

function isCasualChatMessage(text: string) {
  const normalized = text.trim().replace(/\s+/g, '')
  if (!normalized) return true
  return /^(你好|您好|在吗|谢谢|多谢|收到|好的|好滴|ok|okk|哈哈|hi|hello|继续|开始吧|可以|行吧|嗯嗯|收到啦)[!,.，。？！?]*$/i.test(normalized)
}

function inferCategoryFromContent(text: string) {
  if (/sql|bi|报表|数据|分析|指标|问数|dashboard|gmv|留存|转化|查询|统计|同比|环比|看板/i.test(text)) {
    return '数据任务'
  }
  if (/代码|开发|前端|后端|部署|测试|工程|debug|api|接口|研发|缺陷|发布|脚本/i.test(text)) {
    return '工程任务'
  }
  if (/客服|运营|销售|工单|活动|内容|增长|用户|投放|线索|业务/i.test(text)) {
    return '业务任务'
  }
  return '通用任务'
}

function inferCategoryFromAgent(agent: MultiAgentRouteCandidate | null) {
  if (!agent) return '通用任务'
  const text = candidateText(agent)
  if (/sql|bi|报表|数据|分析|指标|问数|dashboard|gmv|留存|转化/.test(text)) return '数据任务'
  if (/代码|开发|前端|后端|部署|测试|工程|debug|api/.test(text)) return '工程任务'
  if (/客服|运营|销售|工单|活动|内容|增长|用户/.test(text)) return '业务任务'
  return '通用任务'
}

function summarizeText(text: string, maxLength = 72) {
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text
}

function normalizeCandidates(candidates: MultiAgentRouteCandidate[]) {
  return candidates
    .map(candidate => ({
      id: String(candidate.id || '').trim(),
      name: String(candidate.name || candidate.id || '').trim(),
      description: String(candidate.description || '').trim(),
      baseUrl: String(candidate.baseUrl || '').trim(),
      chatPath: String(candidate.chatPath || '/v1/chat/completions').trim() || '/v1/chat/completions',
      enabled: candidate.enabled !== false,
      skills: Array.isArray(candidate.skills) ? candidate.skills : [],
      tools: Array.isArray(candidate.tools) ? candidate.tools : [],
    }))
    .filter(candidate => candidate.id && candidate.name)
}

function canDirectDelegate(agent: MultiAgentRouteCandidate | null, confidence: number, category: string) {
  if (!agent) return false
  if (agent.enabled === false) return false
  if (!agent.baseUrl) return false
  if (confidence >= 84) return true
  return confidence >= 78 && category !== '通用任务'
}

function buildHermesInstructions(decision: MultiAgentRouteDecision) {
  const lines = [
    'Multi-agent collaboration mode is enabled for this run.',
    `Server route category: ${decision.category}.`,
    `Server route confidence: ${decision.confidence}%.`,
    `User request summary: ${decision.summary}`,
  ]
  if (decision.selectedAgent) {
    lines.push(`Preferred sub-agent: ${decision.selectedAgent.name} (${decision.selectedAgent.id}).`)
    if (decision.selectedAgent.description) lines.push(`Sub-agent description: ${decision.selectedAgent.description}`)
    if ((decision.selectedAgent.skills || []).length > 0) {
      lines.push(`Sub-agent skills: ${(decision.selectedAgent.skills || []).map(skill => skill.name || '').filter(Boolean).join(', ')}`)
    }
    if ((decision.selectedAgent.tools || []).length > 0) {
      lines.push(`Sub-agent tools: ${(decision.selectedAgent.tools || []).map(tool => tool.name || '').filter(Boolean).join(', ')}`)
    }
  } else {
    lines.push('No confident sub-agent match was found from the current runtime list.')
  }
  lines.push(
    'Execution policy:',
    '- Treat this as a general task portal, not a coding-only workflow.',
    `- Router intent: ${decision.intent}.`,
    '- Before using unrelated built-in skills, validate whether the preferred sub-agent should handle the request.',
    '- If direct delegation is unavailable in the current runtime, stay in orchestrator mode and explain the chosen path clearly.',
    '- Keep the final answer aligned with the selected execution path instead of silently falling back to arbitrary skills.',
  )
  if (decision.todo.length > 0) {
    lines.push(`- Router todo: ${decision.todo.join(' -> ')}`)
  }
  if (decision.constraints.length > 0) {
    lines.push(`- Router constraints: ${decision.constraints.join('；')}`)
  }
  return lines.join('\n')
}

function buildFallbackExecutionPlan(summary: string, routeText: string): MultiAgentExecutionPlan {
  const hermesExecutor: MultiAgentPlanNodeExecutor = {
    type: 'hermes',
    name: 'Hermes',
  }
  return {
    objective: summary,
    status: 'running',
    currentNodeId: 'route',
    nodes: [
      {
        id: 'understand',
        title: '理解需求与约束',
        phase: '分析',
        status: 'done',
        executor: hermesExecutor,
        summary: '已接收用户需求并提取当前任务目标。',
      },
      {
        id: 'route',
        title: '确认执行路径',
        phase: '路由',
        status: 'doing',
        executor: hermesExecutor,
        summary: routeText,
      },
      {
        id: 'respond',
        title: '汇总阶段成果并回复用户',
        phase: '汇总',
        status: 'todo',
        executor: hermesExecutor,
        summary: '等待执行完成后生成最终回复。',
      },
    ],
  }
}

function planTaskNodeId(taskId: string, index: number) {
  const normalized = String(taskId || `task-${index + 1}`)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `task_${normalized || index + 1}`
}

function findTaskRoute(taskId: string, routes: TaskPlanAgentRoute[]) {
  return routes.find(route => normalizeKey(route.task_id) === normalizeKey(taskId)) || null
}

function acceptanceSummary(task: TaskPlanTask) {
  const criteria = Array.isArray(task.acceptance_criteria)
    ? task.acceptance_criteria.map(item => String(item || '').trim()).filter(Boolean)
    : []
  return criteria.slice(0, 2).join('；')
}

function formatTaskSummary(task: TaskPlanTask, route: TaskPlanAgentRoute | null) {
  const parts = [
    String(task.description || '').trim(),
    acceptanceSummary(task) ? `验收：${acceptanceSummary(task)}` : '',
    route?.reason ? `分配理由：${String(route.reason || '').trim()}` : '',
  ].filter(Boolean)
  return summarizeText(parts.join('。'), 160) || '等待执行。'
}

function taskExecutor(
  task: TaskPlanTask,
  route: TaskPlanAgentRoute | null,
  candidates: MultiAgentRouteCandidate[],
): MultiAgentPlanNodeExecutor {
  const recommendedId = normalizeKey(route?.agent_id || task.recommended_agent_id)
  const recommendedName = String(route?.agent_name || task.recommended_agent_name || '').trim()
  const candidate = candidates.find(item =>
    normalizeKey(item.id) === recommendedId
    || (recommendedName && normalizeKey(item.name) === normalizeKey(recommendedName)),
  ) || null
  if (candidate) {
    return {
      type: 'subagent',
      id: candidate.id,
      name: candidate.name,
    }
  }
  return {
    type: 'hermes',
    name: 'Hermes',
  }
}

export function pickDominantPlannedAgent(plan: GeneratedTaskPlan['plan'], candidates: MultiAgentRouteCandidate[]) {
  const buckets = new Map<string, {
    agent: MultiAgentRouteCandidate
    score: number
    totalConfidence: number
    taskIds: string[]
  }>()

  for (const route of plan.agent_routes || []) {
    const candidate = candidates.find(item =>
      normalizeKey(item.id) === normalizeKey(route.agent_id)
      || (route.agent_name && normalizeKey(item.name) === normalizeKey(route.agent_name)),
    )
    if (!candidate) continue
    const confidence = Number.isFinite(route.confidence) ? Math.max(0, Math.min(1, Number(route.confidence))) : 0.5
    const current = buckets.get(candidate.id) || {
      agent: candidate,
      score: 0,
      totalConfidence: 0,
      taskIds: [],
    }
    current.score += Math.max(0.2, confidence)
    current.totalConfidence += confidence
    if (route.task_id && !current.taskIds.includes(route.task_id)) current.taskIds.push(route.task_id)
    buckets.set(candidate.id, current)
  }

  const ranked = [...buckets.values()].sort((left, right) => right.score - left.score)
  if (ranked.length === 0) return null
  const winner = ranked[0]
  return {
    agent: winner.agent,
    averageConfidence: winner.totalConfidence / Math.max(1, winner.taskIds.length),
    taskIds: winner.taskIds,
  }
}

function plannedConfidencePercent(averageConfidence: number, taskCount: number) {
  return Math.max(
    78,
    Math.min(98, 70 + Math.round(Math.max(0, Math.min(1, averageConfidence)) * 20) + Math.min(8, taskCount * 2)),
  )
}

export function buildExecutionPlanFromTaskPlanner(args: {
  generated: GeneratedTaskPlan
  routeText: string
  candidates: MultiAgentRouteCandidate[]
}): MultiAgentExecutionPlan {
  const hermesExecutor: MultiAgentPlanNodeExecutor = {
    type: 'hermes',
    name: 'Hermes',
  }
  const routes = args.generated.plan.agent_routes || []
  const taskNodes = args.generated.plan.tasks.map((task, index): MultiAgentPlanNode => {
    const route = findTaskRoute(task.id, routes)
    return {
      id: planTaskNodeId(task.id, index),
      title: String(task.title || `任务 ${index + 1}`).trim() || `任务 ${index + 1}`,
      phase: String(task.phase || `阶段 ${index + 1}`).trim() || `阶段 ${index + 1}`,
      status: 'todo',
      executor: taskExecutor(task, route, args.candidates),
      summary: formatTaskSummary(task, route),
    }
  })

  return {
    objective: args.generated.summary || args.generated.title || '已生成任务规划',
    status: 'running',
    currentNodeId: 'route',
    nodes: [
      {
        id: 'understand',
        title: '理解需求与约束',
        phase: '分析',
        status: 'done',
        executor: hermesExecutor,
        summary: '已接收用户需求并提取当前任务目标。',
      },
      {
        id: 'route',
        title: '确认执行路径',
        phase: '路由',
        status: 'doing',
        executor: hermesExecutor,
        summary: args.routeText,
      },
      ...taskNodes,
      {
        id: 'respond',
        title: '汇总阶段成果并回复用户',
        phase: '汇总',
        status: 'todo',
        executor: hermesExecutor,
        summary: '等待前置任务完成后由 Hermes 组织最终回复。',
      },
    ],
  }
}

function formatPlanForInstructions(generated: GeneratedTaskPlan) {
  const routes = generated.plan.agent_routes || []
  const lines = [
    'Planner todo list:',
    ...generated.plan.tasks.map((task, index) => {
      const route = findTaskRoute(task.id, routes)
      const owner = route?.agent_name || task.recommended_agent_name || 'Hermes'
      return `${index + 1}. [${task.phase}] ${task.title} -> ${owner}; ${formatTaskSummary(task, route)}`
    }),
  ]
  if ((generated.plan.risks || []).length > 0) {
    lines.push('Planner risks:')
    for (const risk of generated.plan.risks.slice(0, 5)) {
      lines.push(`- ${risk}`)
    }
  }
  return lines.join('\n')
}

function buildBaseRouteDecision(input: {
  enabled?: boolean
  input: string | ContentBlock[]
  candidates?: MultiAgentRouteCandidate[]
}): MultiAgentRouteDecision {
  const inputText = extractTextForPreview(input.input).trim() || contentBlocksToString(input.input).trim()
  const enabled = input.enabled === true
  if (!enabled) {
    return {
      enabled: false,
      shouldPlan: false,
      summary: summarizeText(inputText),
      intent: 'disabled',
      category: '普通对话',
      confidence: 0,
      reason: '多智能体协作模式未开启。',
      executionMode: 'hermes_native',
      selectedAgent: null,
      routeText: '多智能体协作未开启，继续由 Hermes 默认链路处理。',
      hermesInstructions: null,
      inputText,
      todo: [],
      constraints: [],
      plan: null,
      delegatedNodeIds: [],
    }
  }

  const casual = isCasualChatMessage(inputText)
  const candidates = normalizeCandidates(input.candidates || [])
  const terms = extractIntentTerms(inputText)
  const best = chooseCandidate(candidates, terms)
  const categoryFromContent = inferCategoryFromContent(inputText)
  const categoryFromAgent = inferCategoryFromAgent(best?.agent || null)
  const category = categoryFromContent !== '通用任务' ? categoryFromContent : categoryFromAgent
  const shouldPlan = !casual
  const structureBoost = Math.min(10, Math.floor(Math.min(inputText.length, 120) / 18))
  const categoryBoost = category !== '通用任务' ? 8 : 0
  const scoreBoost = best ? Math.min(18, best.score) : 0
  const confidence = shouldPlan
    ? Math.min(98, 76 + structureBoost + categoryBoost + scoreBoost)
    : Math.min(52, 30 + structureBoost)
  const selectedAgent = best?.agent || null
  const directDelegate = shouldPlan && canDirectDelegate(selectedAgent, confidence, category)
  const executionMode = directDelegate ? 'delegate_subagent' : 'hermes_native'

  let reason = '当前消息更适合继续由 Hermes 直接处理。'
  if (!shouldPlan) {
    reason = '识别为普通寒暄或轻量对话，不进入多智能体路由。'
  } else if (selectedAgent && directDelegate) {
    reason = `根据消息内容与子智能体元数据相似度，优先直连 ${selectedAgent.name}。`
  } else if (selectedAgent) {
    reason = `已匹配到 ${selectedAgent.name}，但当前不满足直连条件，改由 Hermes 编排执行。`
  } else {
    reason = '没有找到高置信度的子智能体配置，改由 Hermes 编排执行。'
  }

  let routeText = '多智能体协作：继续由 Hermes 默认链路处理。'
  if (!shouldPlan) {
    routeText = '多智能体协作：识别为普通对话，继续由 Hermes 直接处理。'
  } else if (selectedAgent && directDelegate) {
    routeText = `多智能体协作：已路由到子智能体「${selectedAgent.name}」(${category}，置信度 ${confidence}%)，将优先直连其运行时。`
  } else if (selectedAgent) {
    routeText = `多智能体协作：匹配到子智能体「${selectedAgent.name}」(${category}，置信度 ${confidence}%)，当前改由 Hermes 编排执行。`
  } else {
    routeText = `多智能体协作：未找到高置信度子智能体(${category}，置信度 ${confidence}%)，继续由 Hermes 编排执行。`
  }

  const decision: MultiAgentRouteDecision = {
    enabled,
    shouldPlan,
    summary: summarizeText(inputText),
    intent: casual ? 'casual_chat' : 'general_request',
    category: shouldPlan ? category : '普通对话',
    confidence,
    reason,
    executionMode,
    selectedAgent,
    routeText,
    hermesInstructions: shouldPlan ? buildHermesInstructions({
      enabled,
      shouldPlan,
      summary: summarizeText(inputText),
      intent: casual ? 'casual_chat' : 'general_request',
      category,
      confidence,
      reason,
      executionMode,
      selectedAgent,
      routeText,
      hermesInstructions: null,
      inputText,
      todo: [],
      constraints: [],
      plan: null,
      delegatedNodeIds: [],
    }) : null,
    inputText,
    todo: shouldPlan ? ['理解需求', '选择执行路径'] : [],
    constraints: [],
    plan: shouldPlan ? buildFallbackExecutionPlan(summarizeText(inputText), routeText) : null,
    delegatedNodeIds: [],
  }
  return decision
}

function selectCandidateFromRouter(args: {
  normalizedCandidates: MultiAgentRouteCandidate[]
  routed: GeneratedTaskRouteDecision
  fallback: MultiAgentRouteCandidate | null
}) {
  const byId = args.normalizedCandidates.find(candidate =>
    normalizeKey(candidate.id) === normalizeKey(args.routed.selected_agent_id),
  )
  if (byId) return byId
  const byName = args.normalizedCandidates.find(candidate =>
    args.routed.selected_agent_name && normalizeKey(candidate.name) === normalizeKey(args.routed.selected_agent_name),
  )
  if (byName) return byName
  return args.fallback
}

function mapRouterExecutionMode(mode: GeneratedTaskRouteDecision['execution_mode'], selectedAgent: MultiAgentRouteCandidate | null, confidence: number, category: string) {
  if (mode === 'subagent' && canDirectDelegate(selectedAgent, confidence, category)) return 'delegate_subagent' as const
  return 'hermes_native' as const
}

function shouldUseRuntimeDelegateOverride(args: {
  base: MultiAgentRouteDecision
  routed: GeneratedTaskRouteDecision
  selectedAgent: MultiAgentRouteCandidate | null
  category: string
  confidence: number
}) {
  if (!args.base.shouldPlan) return false
  if (!args.selectedAgent) return false
  if (args.selectedAgent.enabled === false) return false
  if (!args.selectedAgent.baseUrl) return false
  if (args.routed.execution_mode === 'subagent') return false
  if (isCasualChatMessage(args.base.inputText)) return false
  if (args.base.executionMode === 'delegate_subagent') return true
  if (args.category === '通用任务') return false
  if (!args.base.selectedAgent) return false
  return normalizeKey(args.base.selectedAgent.id) === normalizeKey(args.selectedAgent.id) && args.confidence >= 88
}

function fallbackDelegateTodo(agent: MultiAgentRouteCandidate) {
  return [
    '确认用户查询目标与可用数据源',
    `将任务交给${agent.name}执行`,
    '接收子智能体阶段结果并汇总回复',
  ]
}

function mergeDelegateOverrideConstraints(constraints: string[]) {
  const cleaned = constraints
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .filter(item => !/(不能|无法|拒绝|不允许|不提供|直接回答)/.test(item))
    .slice(0, 4)
  if (!cleaned.some(item => /权限|合规|授权|数据源/.test(item))) {
    cleaned.push('由子智能体返回数据源权限、缺失参数或合规校验结果。')
  }
  return cleaned
}

function buildRouterRouteText(args: {
  mode: GeneratedTaskRouteDecision['execution_mode']
  selectedAgent: MultiAgentRouteCandidate | null
  category: string
  confidence: number
  needClarify: boolean
}) {
  if (args.mode === 'direct') {
    return `多智能体协作：识别为普通对话，继续由 Hermes 直接回答。`
  }
  if (args.needClarify || args.mode === 'clarify') {
    return '多智能体协作：当前信息不足，先向用户澄清后再继续执行。'
  }
  if (args.mode === 'subagent' && args.selectedAgent) {
    return `多智能体协作：已匹配子智能体「${args.selectedAgent.name}」(${args.category}，置信度 ${args.confidence}%)，优先交由其执行。`
  }
  return `多智能体协作：当前由 Hermes 编排执行(${args.category}，置信度 ${args.confidence}%)。`
}

function fallbackTaskCount(decision: MultiAgentRouteDecision) {
  return Math.max(2, Math.min(5, decision.todo.length || 2))
}

function buildExecutionPlanFromRouterTodo(decision: MultiAgentRouteDecision): MultiAgentExecutionPlan | null {
  if (!decision.shouldPlan || decision.executionMode === 'hermes_native' && decision.intent === 'casual_chat') return null
  const hermesExecutor: MultiAgentPlanNodeExecutor = { type: 'hermes', name: 'Hermes' }
  const selectedExecutor: MultiAgentPlanNodeExecutor = decision.executionMode === 'delegate_subagent' && decision.selectedAgent
    ? { type: 'subagent', id: decision.selectedAgent.id, name: decision.selectedAgent.name }
    : hermesExecutor
  const todo = decision.todo.length > 0
    ? decision.todo.slice(0, 5)
    : Array.from({ length: fallbackTaskCount(decision) }, (_, index) => `执行步骤 ${index + 1}`)
  const taskNodes = todo.map((item, index): MultiAgentPlanNode => ({
    id: `task_router_${index + 1}`,
    title: item,
    phase: index === 0 ? '分析' : index === todo.length - 1 ? '汇总' : '执行',
    status: 'todo',
    executor: selectedExecutor,
    summary: decision.constraints[index] || decision.reason || '等待执行。',
  }))
  return {
    objective: decision.summary,
    status: 'running',
    currentNodeId: 'route',
    nodes: [
      {
        id: 'understand',
        title: '理解需求与约束',
        phase: '分析',
        status: 'done',
        executor: hermesExecutor,
        summary: '已接收用户需求并抽取当前目标。',
      },
      {
        id: 'route',
        title: '确认执行路径',
        phase: '路由',
        status: 'doing',
        executor: hermesExecutor,
        summary: decision.routeText,
      },
      ...taskNodes,
      {
        id: 'respond',
        title: '汇总阶段成果并回复用户',
        phase: '汇总',
        status: 'todo',
        executor: hermesExecutor,
        summary: '等待前置步骤完成后由 Hermes 组织最终回复。',
      },
    ],
  }
}

function delegatedNodeIdsFromPlan(plan: MultiAgentExecutionPlan | null, selectedAgent: MultiAgentRouteCandidate | null) {
  if (!plan || !selectedAgent) return []
  return plan.nodes
    .filter(node => node.executor.type === 'subagent' && normalizeKey(node.executor.id) === normalizeKey(selectedAgent.id))
    .map(node => node.id)
}

export async function resolveMultiAgentRoute(input: {
  enabled?: boolean
  input: string | ContentBlock[]
  candidates?: MultiAgentRouteCandidate[]
  profile: string
  provider?: string
  model?: string
  onProgress?: (event: MultiAgentRouteProgressEvent) => void
  onReasoning?: (event: MultiAgentRouteReasoningEvent) => void
}): Promise<MultiAgentRouteDecision> {
  const base = buildBaseRouteDecision(input)
  if (!base.enabled || !base.shouldPlan) return base

  const normalizedCandidates = normalizeCandidates(input.candidates || [])
  try {
    input.onProgress?.({
      stage: 'understand',
      status: 'done',
      text: '主智能体已完成基础需求理解。',
    })
    input.onProgress?.({
      stage: 'route',
      status: 'running',
      text: '主智能体正在生成路由决策。',
    })
    const routeReasoningPromise = streamTaskRouteReasoning({
      profile: input.profile,
      requirement: base.inputText,
      provider: input.provider,
      model: input.model,
      agents: normalizedCandidates,
      onChunk: (chunk) => {
        const cleaned = summarizeText(String(chunk.text || '').replace(/\s+/g, ' ').trim(), 180)
        if (!cleaned) return
        input.onReasoning?.({
          stage: 'route',
          text: cleaned,
        })
      },
    }).catch(() => null)
    const routed = await generateTaskRouteDecision({
      profile: input.profile,
      requirement: base.inputText,
      provider: input.provider,
      model: input.model,
      agents: normalizedCandidates,
    })
    await routeReasoningPromise
    const selectedAgent = selectCandidateFromRouter({
      normalizedCandidates,
      routed,
      fallback: base.selectedAgent,
    })
    const category = routed.category !== '通用任务'
      ? routed.category
      : (base.category !== '通用任务' ? base.category : inferCategoryFromAgent(selectedAgent))
    const confidence = Math.max(base.confidence, Math.round(Math.max(0, Math.min(1, routed.confidence)) * 100))
    const runtimeDelegateOverride = shouldUseRuntimeDelegateOverride({
      base,
      routed,
      selectedAgent,
      category,
      confidence,
    })
    const effectiveRouteMode: GeneratedTaskRouteDecision['execution_mode'] = runtimeDelegateOverride
      ? 'subagent'
      : routed.execution_mode
    const effectiveNeedClarify = runtimeDelegateOverride ? false : routed.need_clarify
    const executionMode = mapRouterExecutionMode(effectiveRouteMode, selectedAgent, confidence, category)
    const routeText = buildRouterRouteText({
      mode: effectiveRouteMode,
      selectedAgent,
      category,
      confidence,
      needClarify: effectiveNeedClarify,
    })
    const routerReason = runtimeDelegateOverride && selectedAgent
      ? `路由模型返回 ${routed.execution_mode}，但运行时能力匹配已确认 ${selectedAgent.name} 更适合作为主执行方。`
      : routed.reason
    const todo = runtimeDelegateOverride && selectedAgent
      ? fallbackDelegateTodo(selectedAgent)
      : routed.todo
    const constraints = runtimeDelegateOverride
      ? mergeDelegateOverrideConstraints(routed.constraints)
      : routed.constraints
    const decisionFromRouter: MultiAgentRouteDecision = {
      ...base,
      summary: summarizeText(base.inputText),
      intent: routed.intent,
      category,
      confidence,
      reason: routerReason,
      executionMode,
      selectedAgent,
      routeText,
      inputText: base.inputText,
      todo,
      constraints,
      hermesInstructions: null,
      plan: null,
      delegatedNodeIds: [],
    }
    input.onProgress?.({
      stage: 'route',
      status: 'done',
      text: effectiveNeedClarify
        ? '主智能体已判断当前信息不足，需要先澄清。'
        : `主智能体已完成路由决策，执行模式：${effectiveRouteMode}。`,
    })

    if (effectiveNeedClarify || effectiveRouteMode === 'clarify' || effectiveRouteMode === 'direct') {
      const plan = buildExecutionPlanFromRouterTodo(decisionFromRouter)
      return {
        ...decisionFromRouter,
        shouldPlan: effectiveRouteMode !== 'direct',
        plan,
        delegatedNodeIds: delegatedNodeIdsFromPlan(plan, selectedAgent),
        hermesInstructions: buildHermesInstructions({
          ...decisionFromRouter,
          shouldPlan: effectiveRouteMode !== 'direct',
          plan,
          delegatedNodeIds: delegatedNodeIdsFromPlan(plan, selectedAgent),
        }),
      }
    }

    input.onProgress?.({
      stage: 'match_agents',
      status: 'running',
      text: selectedAgent
        ? `主智能体正在校验子智能体「${selectedAgent.name}」是否适合作为主执行方。`
        : '主智能体未命中高置信度子智能体，准备由 Hermes 编排执行。',
    })
    input.onReasoning?.({
      stage: 'match_agents',
      text: selectedAgent
        ? `正在比对子智能体能力与任务目标，确认是否交由 ${selectedAgent.name} 主执行。`
        : '未命中可直接委派对象，开始生成由 Hermes 编排的执行清单。',
    })
    const generated = await generateTaskPlan({
      profile: input.profile,
      requirement: base.inputText,
      provider: input.provider,
      model: input.model,
      agents: normalizedCandidates,
    })
    const plannedPick = pickDominantPlannedAgent(generated.plan, normalizedCandidates)
    const dominantAgent = plannedPick?.agent || selectedAgent
    const plannedCategory = category !== '通用任务' ? category : inferCategoryFromAgent(dominantAgent)
    const plannedConfidence = plannedPick
      ? Math.max(confidence, plannedConfidencePercent(plannedPick.averageConfidence, plannedPick.taskIds.length))
      : confidence
    const plannedExecutionMode = mapRouterExecutionMode(effectiveRouteMode, dominantAgent, plannedConfidence, plannedCategory)

    let reason = decisionFromRouter.reason
    let finalRouteText = routeText
    if (plannedPick?.agent && plannedExecutionMode === 'delegate_subagent') {
      reason = runtimeDelegateOverride
        ? `${decisionFromRouter.reason} 主智能体已完成任务规划，识别出 ${plannedPick.agent.name} 是主要执行方。`
        : `主智能体已完成任务规划，识别出 ${plannedPick.agent.name} 是主要执行方。`
      finalRouteText = `多智能体协作：主智能体已完成任务规划，主执行子智能体为「${plannedPick.agent.name}」(${plannedCategory}，置信度 ${plannedConfidence}%)，将优先直连其运行时。`
    } else if (plannedPick?.agent) {
      reason = runtimeDelegateOverride
        ? `${decisionFromRouter.reason} 主智能体已完成任务规划，匹配到 ${plannedPick.agent.name}，当前改由 Hermes 编排执行。`
        : `主智能体已完成任务规划，匹配到 ${plannedPick.agent.name}，当前改由 Hermes 编排执行。`
      finalRouteText = `多智能体协作：主智能体已完成任务规划，匹配到子智能体「${plannedPick.agent.name}」(${plannedCategory}，置信度 ${plannedConfidence}%)，当前由 Hermes 编排执行。`
    } else {
      reason = '主智能体已完成任务规划，当前由 Hermes 继续编排。'
      finalRouteText = '多智能体协作：主智能体已完成任务规划，未匹配到可直连子智能体，继续由 Hermes 编排执行。'
    }

    const executionPlan = buildExecutionPlanFromTaskPlanner({
      generated,
      routeText: finalRouteText,
      candidates: normalizedCandidates,
    })
    const delegatedNodeIds = plannedExecutionMode === 'delegate_subagent'
      ? (plannedPick?.taskIds.length
          ? plannedPick.taskIds.map((taskId, index) => planTaskNodeId(taskId, index))
          : (generated.plan.tasks[0] ? [planTaskNodeId(generated.plan.tasks[0].id, 0)] : []))
      : []
    input.onProgress?.({
      stage: 'match_agents',
      status: 'done',
      text: dominantAgent
        ? `主智能体已确认主执行方：${dominantAgent.name}。`
        : '主智能体已确认由 Hermes 主链路继续执行。',
    })

    return {
      ...decisionFromRouter,
      category: plannedCategory,
      confidence: plannedConfidence,
      reason,
      executionMode: plannedExecutionMode,
      selectedAgent: dominantAgent,
      routeText: finalRouteText,
      hermesInstructions: `${buildHermesInstructions({
        ...decisionFromRouter,
        category: plannedCategory,
        confidence: plannedConfidence,
        reason,
        executionMode: plannedExecutionMode,
        selectedAgent: dominantAgent,
        routeText: finalRouteText,
        hermesInstructions: null,
        plan: null,
        delegatedNodeIds,
      })}\n\n${formatPlanForInstructions(generated)}`,
      plan: executionPlan,
      delegatedNodeIds,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ...base,
      intent: base.intent || 'fallback_skill',
      reason: `${base.reason} 任务规划生成失败：${message}`,
      routeText: `${base.routeText} 任务规划生成失败，当前不展示伪造节点。`,
      hermesInstructions: base.hermesInstructions
        ? `${base.hermesInstructions}\n\nPlanner status: failed to generate todo list. Continue without fabricating a plan.`
        : null,
      plan: null,
      delegatedNodeIds: [],
    }
  }
}
