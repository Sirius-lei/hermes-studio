import { generateTaskPlan, type GeneratedTaskPlan, type TaskPlanAgentRoute, type TaskPlanTask } from '../../task-planner'
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
  category: string
  confidence: number
  reason: string
  executionMode: 'delegate_subagent' | 'hermes_native'
  selectedAgent: MultiAgentRouteCandidate | null
  routeText: string
  hermesInstructions: string | null
  inputText: string
  plan: MultiAgentExecutionPlan | null
  delegatedNodeIds: string[]
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
    '- Before using unrelated built-in skills, validate whether the preferred sub-agent should handle the request.',
    '- If direct delegation is unavailable in the current runtime, stay in orchestrator mode and explain the chosen path clearly.',
    '- Keep the final answer aligned with the selected execution path instead of silently falling back to arbitrary skills.',
  )
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
      category: '普通对话',
      confidence: 0,
      reason: '多智能体协作模式未开启。',
      executionMode: 'hermes_native',
      selectedAgent: null,
      routeText: '多智能体协作未开启，继续由 Hermes 默认链路处理。',
      hermesInstructions: null,
      inputText,
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
      category,
      confidence,
      reason,
      executionMode,
      selectedAgent,
      routeText,
      hermesInstructions: null,
      inputText,
      plan: null,
      delegatedNodeIds: [],
    }) : null,
    inputText,
    plan: shouldPlan ? buildFallbackExecutionPlan(summarizeText(inputText), routeText) : null,
    delegatedNodeIds: [],
  }
  return decision
}

export async function resolveMultiAgentRoute(input: {
  enabled?: boolean
  input: string | ContentBlock[]
  candidates?: MultiAgentRouteCandidate[]
  profile: string
  provider?: string
  model?: string
}): Promise<MultiAgentRouteDecision> {
  const base = buildBaseRouteDecision(input)
  if (!base.enabled || !base.shouldPlan) return base

  const normalizedCandidates = normalizeCandidates(input.candidates || [])
  try {
    const generated = await generateTaskPlan({
      profile: input.profile,
      requirement: base.inputText,
      provider: input.provider,
      model: input.model,
      agents: normalizedCandidates,
    })
    const plannedPick = pickDominantPlannedAgent(generated.plan, normalizedCandidates)
    const selectedAgent = plannedPick?.agent || base.selectedAgent
    const category = base.category !== '通用任务' ? base.category : inferCategoryFromAgent(selectedAgent)
    const confidence = plannedPick
      ? Math.max(base.confidence, plannedConfidencePercent(plannedPick.averageConfidence, plannedPick.taskIds.length))
      : base.confidence
    const executionMode = canDirectDelegate(selectedAgent, confidence, category)
      ? 'delegate_subagent'
      : 'hermes_native'

    let reason = base.reason
    let routeText = base.routeText
    if (plannedPick?.agent && executionMode === 'delegate_subagent') {
      reason = `主智能体已完成任务规划，识别出 ${plannedPick.agent.name} 是主要执行方。`
      routeText = `多智能体协作：主智能体已完成任务规划，主执行子智能体为「${plannedPick.agent.name}」(${category}，置信度 ${confidence}%)，将优先直连其运行时。`
    } else if (plannedPick?.agent) {
      reason = `主智能体已完成任务规划，匹配到 ${plannedPick.agent.name}，当前改由 Hermes 编排执行。`
      routeText = `多智能体协作：主智能体已完成任务规划，匹配到子智能体「${plannedPick.agent.name}」(${category}，置信度 ${confidence}%)，当前由 Hermes 编排执行。`
    } else {
      reason = '主智能体已完成任务规划，当前由 Hermes 继续编排。'
      routeText = '多智能体协作：主智能体已完成任务规划，未匹配到可直连子智能体，继续由 Hermes 编排执行。'
    }

    const delegatedNodeIds = executionMode === 'delegate_subagent'
      ? (plannedPick?.taskIds.length
          ? plannedPick.taskIds.map((taskId, index) => planTaskNodeId(taskId, index))
          : (generated.plan.tasks[0] ? [planTaskNodeId(generated.plan.tasks[0].id, 0)] : []))
      : []

    return {
      ...base,
      category,
      confidence,
      reason,
      executionMode,
      selectedAgent,
      routeText,
      hermesInstructions: `${buildHermesInstructions({
        ...base,
        category,
        confidence,
        reason,
        executionMode,
        selectedAgent,
        routeText,
        hermesInstructions: null,
        plan: null,
        delegatedNodeIds,
      })}\n\n${formatPlanForInstructions(generated)}`,
      plan: buildExecutionPlanFromTaskPlanner({
        generated,
        routeText,
        candidates: normalizedCandidates,
      }),
      delegatedNodeIds,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ...base,
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
