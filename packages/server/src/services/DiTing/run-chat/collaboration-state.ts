type SnapshotStatus = 'idle' | 'running' | 'completed' | 'failed'
type NodeStatus = 'todo' | 'doing' | 'done' | 'partial' | 'blocked' | 'unsafe' | 'failed' | 'waiting_replan' | 'invalidated' | 'skipped'
type NodeOutcome = 'unknown' | 'success' | 'partial' | 'failure' | 'unsafe'
type ThinkingStatus = 'pending' | 'running' | 'done'

export interface CollaborationSnapshotNode {
  id: string
  title: string
  phase: string
  status: NodeStatus
  outcome: NodeOutcome
  dependsOn: string[]
  executor: {
    type: 'DiTing' | 'subagent'
    id?: string
    name: string
  }
  summary: string
}

export interface CollaborationSnapshotDependency {
  from: string
  to: string
  type: 'blocks' | 'informs'
}

export interface CollaborationSnapshotActivity {
  id: string
  kind: string
  title: string
  text: string
  status: 'info' | 'running' | 'done' | 'error'
  timestamp: number
  agentId?: string
  agentName?: string
  toolName?: string
  output?: string
}

export interface CollaborationSnapshotThinkingStep {
  id: string
  title: string
  detail: string
  status: ThinkingStatus
}

export interface CollaborationSnapshotState {
  runId: string
  sessionId: string
  mode: 'delegate_subagent' | 'DiTing_native'
  intent: string
  category: string
  reason: string
  text: string
  objective: string
  status: SnapshotStatus
  currentNodeId: string | null
  selectedAgentId: string
  selectedAgentName: string
  todo: string[]
  constraints: string[]
  planNodes: CollaborationSnapshotNode[]
  planDependencies: CollaborationSnapshotDependency[]
  activity: CollaborationSnapshotActivity[]
  thinkingSteps: CollaborationSnapshotThinkingStep[]
  startedAt: number
  endedAt: number | null
}

const RESERVED_NODE_IDS = new Set(['understand', 'route', 'respond'])

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(textValue).filter(Boolean)
}

function summarizeText(value: unknown, max = 220): string {
  const normalized = textValue(value).replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > max ? `${normalized.slice(0, max - 3).trimEnd()}...` : normalized
}

function normalizeNodeStatus(value: unknown, fallback: NodeStatus): NodeStatus {
  return value === 'todo'
    || value === 'doing'
    || value === 'done'
    || value === 'partial'
    || value === 'blocked'
    || value === 'unsafe'
    || value === 'failed'
    || value === 'waiting_replan'
    || value === 'invalidated'
    || value === 'skipped'
    ? value
    : fallback
}

function normalizeNodeOutcome(value: unknown, status?: NodeStatus): NodeOutcome {
  if (value === 'unknown' || value === 'success' || value === 'partial' || value === 'failure' || value === 'unsafe') return value
  if (status === 'done') return 'success'
  if (status === 'partial') return 'partial'
  if (status === 'unsafe') return 'unsafe'
  if (status === 'blocked' || status === 'failed' || status === 'waiting_replan' || status === 'invalidated' || status === 'skipped') return 'failure'
  return 'unknown'
}

function isTerminalNodeStatus(status: NodeStatus) {
  return status === 'done'
    || status === 'partial'
    || status === 'unsafe'
    || status === 'blocked'
    || status === 'failed'
    || status === 'waiting_replan'
    || status === 'invalidated'
    || status === 'skipped'
}

function routeTodoNodeId(index: number): string {
  return `task_route_${index + 1}`
}

function shouldKeepRouteTodoTask(title: string, index: number, total: number): boolean {
  if (/(意图识别|任务拆解|Todo生成|绘制节点|生成路由|确认执行路径|选择执行路径)/i.test(title)) return false
  if (index === total - 1 && /(汇总|总结|回复|输出|交付)/.test(title)) return false
  return true
}

function inferRouteTodoPhase(title: string, index: number, total: number): string {
  if (index === 0 || /(理解|确认|识别|澄清|校验|权限|约束|目标)/.test(title)) return '分析'
  if (index === total - 1 || /(汇总|总结|回复|输出|交付)/.test(title)) return '汇总'
  return '执行'
}

function fallbackTaskSummary(title: string, constraint: string, selectedAgentName: string, delegated: boolean): string {
  if (constraint) return constraint
  if (delegated && selectedAgentName) return `等待 ${selectedAgentName} 执行该节点。`
  if (/(汇总|总结|回复|输出|交付)/.test(title)) return '等待前置节点完成后汇总阶段成果。'
  if (/(理解|确认|识别|澄清|校验|权限|约束|目标)/.test(title)) return '正在确认目标、约束与可用能力。'
  return '等待执行。'
}

function findDelegateTodoIndex(todo: string[]): number {
  const preferred = todo.findIndex(title => !/(理解|确认|识别|澄清|校验|权限|约束|目标|路由|规划|汇总|总结|回复|输出|交付)/.test(title))
  if (preferred >= 0) return preferred
  if (todo.length >= 3) return 1
  return todo.length > 1 ? todo.length - 2 : 0
}

function buildFallbackPlan(args: {
  mode: 'delegate_subagent' | 'DiTing_native'
  todo: string[]
  constraints: string[]
  selectedAgentId: string
  selectedAgentName: string
  routeText: string
}): {
  nodes: CollaborationSnapshotNode[]
  dependencies: CollaborationSnapshotDependency[]
  currentNodeId: string
} {
  const cleanedTodo = args.todo
    .map(textValue)
    .filter(Boolean)
    .slice(0, 6)
    .filter((title, index, list) => shouldKeepRouteTodoTask(title, index, list.length))
  const delegateIndex = args.mode === 'delegate_subagent' && args.selectedAgentId
    ? findDelegateTodoIndex(cleanedTodo)
    : -1
  const taskNodes = cleanedTodo.map((title, index): CollaborationSnapshotNode => {
    const delegated = index === delegateIndex && !!args.selectedAgentId
    return {
      id: routeTodoNodeId(index),
      title,
      phase: inferRouteTodoPhase(title, index, cleanedTodo.length),
      status: 'todo',
      outcome: 'unknown',
      dependsOn: index > 0 ? [routeTodoNodeId(index - 1)] : [],
      executor: delegated
        ? {
            type: 'subagent',
            id: args.selectedAgentId || undefined,
            name: args.selectedAgentName || '子智能体',
          }
        : {
            type: 'DiTing',
            name: '主智能体',
          },
      summary: fallbackTaskSummary(title, args.constraints[index] || '', args.selectedAgentName, delegated),
    }
  })
  const dependencies = taskNodes.slice(1).map((node, index) => ({
    from: taskNodes[index]!.id,
    to: node.id,
    type: 'blocks' as const,
  }))
  return {
    nodes: [
      {
        id: 'understand',
        title: '理解需求与约束',
        phase: '分析',
        status: 'done',
        outcome: 'success',
        dependsOn: [],
        executor: { type: 'DiTing', name: '主智能体' },
        summary: '已接收用户需求并提取当前任务目标。',
      },
      {
        id: 'route',
        title: '确认执行路径',
        phase: '路由',
        status: taskNodes.length > 0 ? 'doing' : 'done',
        outcome: taskNodes.length > 0 ? 'unknown' : 'success',
        dependsOn: ['understand'],
        executor: { type: 'DiTing', name: '主智能体' },
        summary: args.routeText || '主智能体已生成任务路径。',
      },
      ...taskNodes,
      {
        id: 'respond',
        title: '汇总阶段成果并回复用户',
        phase: '汇总',
        status: taskNodes.length > 0 ? 'todo' : 'doing',
        outcome: 'unknown',
        dependsOn: taskNodes.length > 0 ? [taskNodes[taskNodes.length - 1]!.id] : ['route'],
        executor: { type: 'DiTing', name: '主智能体' },
        summary: '等待执行节点完成后组织最终回复。',
      },
    ],
    dependencies: [
      { from: 'understand', to: 'route', type: 'blocks' as const },
      ...dependencies,
      ...(taskNodes.length > 0 ? [{ from: taskNodes[taskNodes.length - 1]!.id, to: 'respond', type: 'blocks' as const }] : [{ from: 'route', to: 'respond', type: 'blocks' as const }]),
    ],
    currentNodeId: taskNodes.length > 0 ? 'route' : 'respond',
  }
}

function normalizePlanNodes(payload: Record<string, unknown>, mode: 'delegate_subagent' | 'DiTing_native', selectedAgentId: string, selectedAgentName: string, routeText: string) {
  const rawPlan = payload.plan && typeof payload.plan === 'object'
    ? payload.plan as Record<string, unknown>
    : {}
  const rawNodes = Array.isArray(rawPlan.nodes) ? rawPlan.nodes as Array<Record<string, unknown>> : []
  const rawDeps = Array.isArray(rawPlan.dependencies) ? rawPlan.dependencies as Array<Record<string, unknown>> : []
  const todo = textArray(payload.todo)
  const constraints = textArray(payload.constraints)
  if (rawNodes.length === 0) {
    return buildFallbackPlan({
      mode,
      todo,
      constraints,
      selectedAgentId,
      selectedAgentName,
      routeText,
    })
  }
  const nodeIds = rawNodes.map((node, index) => textValue(node.id) || `node_${index + 1}`)
  const validNodeIds = new Set(nodeIds)
  const dependencies = rawDeps
    .map((item): CollaborationSnapshotDependency | null => {
      const from = textValue(item.from)
      const to = textValue(item.to)
      if (!from || !to || from === to || !validNodeIds.has(from) || !validNodeIds.has(to)) return null
      return {
        from,
        to,
        type: item.type === 'informs' ? 'informs' : 'blocks',
      }
    })
    .filter((item): item is CollaborationSnapshotDependency => Boolean(item))
  const dependsOnMap = new Map<string, string[]>()
  if (dependencies.length === 0) {
    nodeIds.slice(1).forEach((nodeId, index) => {
      dependencies.push({
        from: nodeIds[index]!,
        to: nodeId,
        type: 'blocks',
      })
    })
  }
  dependencies.forEach((dep) => {
    const current = dependsOnMap.get(dep.to) || []
    if (!current.includes(dep.from)) current.push(dep.from)
    dependsOnMap.set(dep.to, current)
  })
  const nodes = rawNodes.map((node, index): CollaborationSnapshotNode => ({
    id: nodeIds[index],
    title: textValue(node.title) || `节点 ${index + 1}`,
    phase: textValue(node.phase) || '执行',
    status: normalizeNodeStatus(
      node.status,
      node.id === 'understand'
        ? 'done'
        : node.id === 'route'
          ? 'doing'
          : 'todo',
    ),
    outcome: normalizeNodeOutcome(
      (node as Record<string, unknown>).outcome,
      normalizeNodeStatus(
        node.status,
        node.id === 'understand'
          ? 'done'
          : node.id === 'route'
            ? 'doing'
            : 'todo',
      ),
    ),
    dependsOn: dependsOnMap.get(nodeIds[index]) || [],
    executor: node.executor && typeof node.executor === 'object' && (node.executor as any).type === 'subagent'
      ? {
          type: 'subagent',
          id: textValue((node.executor as any).id) || undefined,
          name: textValue((node.executor as any).name) || selectedAgentName || '子智能体',
        }
      : {
          type: 'DiTing',
          name: textValue((node.executor as any)?.name) || '主智能体',
        },
    summary: summarizeText(node.summary),
  }))
  const executableCount = nodes.filter(node => !RESERVED_NODE_IDS.has(node.id)).length
  const rawCurrentNodeId = textValue(rawPlan.currentNodeId)
  const runningNodeId = nodes.find(node => node.status === 'doing')?.id
  const currentNodeId = runningNodeId
    || (rawCurrentNodeId && validNodeIds.has(rawCurrentNodeId) ? rawCurrentNodeId : '')
    || (executableCount > 0 ? 'route' : 'respond')
  return { nodes, dependencies, currentNodeId }
}

function defaultThinkingSteps(): CollaborationSnapshotThinkingStep[] {
  return [
    {
      id: 'understand',
      title: '理解用户需求',
      detail: '正在接收消息并提炼任务目标。',
      status: 'running',
    },
    {
      id: 'route',
      title: '生成路由决策',
      detail: '等待主智能体判断执行模式与候选智能体。',
      status: 'pending',
    },
    {
      id: 'match',
      title: '确认执行路径',
      detail: '等待主智能体确认主执行方与下一步动作。',
      status: 'pending',
    },
  ]
}

function appendActivity(
  snapshot: CollaborationSnapshotState,
  event: CollaborationSnapshotActivity,
): CollaborationSnapshotState {
  const nextActivity = [...snapshot.activity, event].slice(-40)
  return {
    ...snapshot,
    activity: nextActivity,
  }
}

function updateThinkingStep(
  snapshot: CollaborationSnapshotState,
  stepId: string,
  patch: Partial<CollaborationSnapshotThinkingStep>,
): CollaborationSnapshotState {
  return {
    ...snapshot,
    thinkingSteps: snapshot.thinkingSteps.map(step => step.id === stepId ? { ...step, ...patch } : step),
  }
}

function stageToThinkingStepId(stage: string): 'understand' | 'route' | 'match' {
  if (stage === 'understand') return 'understand'
  if (stage === 'match_agents') return 'match'
  return 'route'
}

function nextReadyNodeId(snapshot: CollaborationSnapshotState, exclude = new Set<string>()): string | null {
  const nodes = snapshot.planNodes.filter(node => !RESERVED_NODE_IDS.has(node.id))
  for (const node of nodes) {
    if (exclude.has(node.id)) continue
    if (isTerminalNodeStatus(node.status) || node.status === 'doing') continue
    const depsReady = (node.dependsOn || []).every(depId => {
      const dep = snapshot.planNodes.find(item => item.id === depId)
      return !dep || dep.status === 'done'
    })
    if (depsReady) return node.id
  }
  return null
}

function collectBlockedDependentNodeIds(snapshot: CollaborationSnapshotState, sourceNodeIds: string[]): string[] {
  const sourceSet = new Set(sourceNodeIds.filter(Boolean))
  if (sourceSet.size === 0) return []
  const queue = [...sourceSet]
  const blocked = new Set<string>()

  while (queue.length > 0) {
    const currentNodeId = queue.shift() || ''
    if (!currentNodeId) continue
    for (const dependency of snapshot.planDependencies) {
      if (dependency.type !== 'blocks' || dependency.from !== currentNodeId) continue
      const nextNodeId = dependency.to
      if (!nextNodeId || sourceSet.has(nextNodeId) || blocked.has(nextNodeId) || nextNodeId === 'understand' || nextNodeId === 'route') continue
      blocked.add(nextNodeId)
      queue.push(nextNodeId)
    }
  }

  return snapshot.planNodes
    .filter(node => blocked.has(node.id))
    .map(node => node.id)
}

function resolveBlockedPlanNodeIds(
  snapshot: CollaborationSnapshotState,
  payload: Record<string, unknown>,
  targetNodeId: string,
): string[] {
  const explicit = Array.isArray(payload.blocked_plan_node_ids)
    ? payload.blocked_plan_node_ids.map(textValue).filter(Boolean)
    : []
  if (explicit.length > 0) {
    const validIds = new Set(snapshot.planNodes.map(node => node.id))
    return explicit.filter(nodeId => validIds.has(nodeId) && nodeId !== targetNodeId)
  }
  return collectBlockedDependentNodeIds(snapshot, [targetNodeId])
}

function normalizeSingleRunningNode(snapshot: CollaborationSnapshotState, runningNodeId: string | null): CollaborationSnapshotState {
  return {
    ...snapshot,
    planNodes: snapshot.planNodes.map(node => {
      if (RESERVED_NODE_IDS.has(node.id)) return node
      if (runningNodeId && node.id === runningNodeId) return { ...node, status: 'doing', outcome: 'unknown' }
      if (node.status === 'doing') return { ...node, status: 'todo', outcome: 'unknown' }
      return node
    }),
  }
}

function resolveTargetNodeId(snapshot: CollaborationSnapshotState, payload: Record<string, unknown>): string {
  const explicitNodeIds = Array.isArray(payload.plan_node_ids)
    ? payload.plan_node_ids.map(textValue).filter(Boolean)
    : []
  const explicit = explicitNodeIds.find(nodeId => snapshot.planNodes.some(node => node.id === nodeId))
  if (explicit) return explicit
  const subagentId = textValue(payload.subagent_id)
  if (subagentId) {
    const candidate = snapshot.planNodes.find(node =>
      !RESERVED_NODE_IDS.has(node.id)
      && node.executor.type === 'subagent'
      && textValue(node.executor.id) === subagentId
      && !isTerminalNodeStatus(node.status)
    )
    if (candidate) return candidate.id
  }
  return nextReadyNodeId(snapshot) || snapshot.currentNodeId || 'respond'
}

export function createCollaborationSnapshot(args: {
  runId: string
  sessionId: string
  objective: string
  mode?: 'delegate_subagent' | 'DiTing_native'
}): CollaborationSnapshotState {
  return {
    runId: args.runId,
    sessionId: args.sessionId,
    mode: args.mode || 'DiTing_native',
    intent: '',
    category: '协作分析',
    reason: '主智能体正在分析用户需求。',
    text: '主智能体正在生成任务规划，请稍候。',
    objective: summarizeText(args.objective, 160),
    status: 'running',
    currentNodeId: 'understand',
    selectedAgentId: '',
    selectedAgentName: '',
    todo: [],
    constraints: [],
    planNodes: [
      {
        id: 'understand',
        title: '理解需求与约束',
        phase: '分析',
        status: 'doing',
        outcome: 'unknown',
        dependsOn: [],
        executor: { type: 'DiTing', name: '主智能体' },
        summary: '主智能体正在读取消息、提取目标与约束。',
      },
      {
        id: 'route',
        title: '确认执行路径',
        phase: '路由',
        status: 'todo',
        outcome: 'unknown',
        dependsOn: ['understand'],
        executor: { type: 'DiTing', name: '主智能体' },
        summary: '等待主智能体完成意图分析与任务拆解。',
      },
      {
        id: 'respond',
        title: '汇总阶段成果并回复用户',
        phase: '汇总',
        status: 'todo',
        outcome: 'unknown',
        dependsOn: ['route'],
        executor: { type: 'DiTing', name: '主智能体' },
        summary: '等待前置节点完成后生成最终回复。',
      },
    ],
    planDependencies: [
      { from: 'understand', to: 'route', type: 'blocks' },
      { from: 'route', to: 'respond', type: 'blocks' },
    ],
    activity: [
      {
        id: `route:reset:${args.sessionId}:${Date.now()}`,
        kind: 'route',
        title: '主智能体开始规划',
        text: '已清空上一轮协作状态，正在生成新的任务路径。',
        status: 'running',
        timestamp: Date.now(),
      },
    ],
    thinkingSteps: defaultThinkingSteps(),
    startedAt: Date.now(),
    endedAt: null,
  }
}

export function applyReasoningEvent(
  snapshot: CollaborationSnapshotState,
  payload: Record<string, unknown>,
): CollaborationSnapshotState {
  const stepId = stageToThinkingStepId(textValue(payload.stage))
  const merged = summarizeText(payload.text, 320)
  if (!merged) return snapshot
  const next = updateThinkingStep(snapshot, stepId, { detail: merged, status: 'running' })
  return appendActivity(next, {
    id: `route:reasoning:${stepId}:${Date.now()}`,
    kind: 'route',
    title: '主智能体思考',
    text: merged,
    status: 'running',
    timestamp: Date.now(),
  })
}

export function applyProgressEvent(
  snapshot: CollaborationSnapshotState,
  payload: Record<string, unknown>,
): CollaborationSnapshotState {
  const stepId = stageToThinkingStepId(textValue(payload.stage))
  const isDone = textValue(payload.status) === 'done'
  const text = summarizeText(payload.text, 240)
  let next = updateThinkingStep(snapshot, stepId, {
    detail: text || snapshot.thinkingSteps.find(step => step.id === stepId)?.detail || '',
    status: isDone ? 'done' : 'running',
  })
  const currentNodeId = stepId === 'understand' ? 'understand' : 'route'
  next = {
    ...next,
    currentNodeId,
    text: text || next.text,
    reason: text || next.reason,
  }
  return appendActivity(next, {
    id: `route:progress:${stepId}:${Date.now()}`,
    kind: 'route',
    title: stepId === 'understand' ? '理解需求' : stepId === 'match' ? '确认执行路径' : '生成路由决策',
    text: text || (isDone ? '已完成。' : '执行中。'),
    status: isDone ? 'done' : 'running',
    timestamp: Date.now(),
  })
}

export function applyRouteEvent(
  snapshot: CollaborationSnapshotState,
  payload: Record<string, unknown>,
): CollaborationSnapshotState {
  const mode = payload.mode === 'delegate_subagent' ? 'delegate_subagent' : 'DiTing_native'
  const selectedAgent = payload.selected_agent && typeof payload.selected_agent === 'object'
    ? payload.selected_agent as Record<string, unknown>
    : {}
  const selectedAgentId = textValue(selectedAgent.id)
  const selectedAgentName = textValue(selectedAgent.name)
  const normalizedPlan = normalizePlanNodes(payload, mode, selectedAgentId, selectedAgentName, textValue(payload.text))
  const objective = textValue((payload.plan as any)?.objective || payload.reason || snapshot.objective)
  return {
    ...appendActivity(snapshot, {
      id: `route:planned:${snapshot.sessionId}:${Date.now()}`,
      kind: 'route',
      title: '任务路径已生成',
      text: summarizeText(payload.text || payload.reason || '已完成路径规划。', 240),
      status: normalizedPlan.nodes.filter(node => !RESERVED_NODE_IDS.has(node.id)).length > 0 ? 'running' : 'done',
      timestamp: Date.now(),
      agentId: selectedAgentId || undefined,
      agentName: selectedAgentName || undefined,
    }),
    mode,
    intent: textValue(payload.intent),
    category: textValue(payload.category) || snapshot.category,
    reason: textValue(payload.reason) || snapshot.reason,
    text: textValue(payload.text) || snapshot.text,
    objective: objective || snapshot.objective,
    status: 'running',
    currentNodeId: normalizedPlan.currentNodeId,
    selectedAgentId,
    selectedAgentName,
    todo: textArray(payload.todo),
    constraints: textArray(payload.constraints),
    planNodes: normalizedPlan.nodes,
    planDependencies: normalizedPlan.dependencies,
    thinkingSteps: [
      {
        id: 'understand',
        title: '理解用户需求',
        detail: '已提取本轮任务目标。',
        status: 'done',
      },
      {
        id: 'route',
        title: '生成路由决策',
        detail: textValue(payload.intent)
          ? `已识别意图：${textValue(payload.intent)}。${textArray(payload.todo).length > 0 ? `待办 ${textArray(payload.todo).length} 项。` : ''}`
          : (textArray(payload.todo).length > 0 ? `已生成 ${textArray(payload.todo).length} 条下一步动作。` : '已完成路由判断。'),
        status: 'done',
      },
      {
        id: 'match',
        title: '确认执行路径',
        detail: selectedAgentName
          ? `已匹配到 ${selectedAgentName}。`
          : (textArray(payload.constraints)[0] || '未匹配到高置信度子智能体，改由主智能体继续执行。'),
        status: 'done',
      },
    ],
  }
}

export function applySubagentEvent(
  snapshot: CollaborationSnapshotState,
  eventName: string,
  payload: Record<string, unknown>,
): CollaborationSnapshotState {
  const targetNodeId = resolveTargetNodeId(snapshot, payload)
  const subagentId = textValue(payload.subagent_id)
  const agentName = textValue(payload.subagent_name || payload.agent_name) || '子智能体'
  const toolName = textValue(payload.tool || payload.tool_name || payload.name)
  const goal = textValue(payload.goal)
  const text = textValue(payload.text || payload.preview)
  const summary = textValue(payload.summary)
  const eventStatus = textValue(payload.status)
  const nodeStatus = textValue(payload.node_status || payload.status)
  const groundingStatus = textValue(payload.grounding_status)
  const finalizable = payload.finalizable === true
  const isClarify = eventName === 'subagent.clarify_required'
  const isFailure = eventName === 'subagent.complete' && (eventStatus === 'failed' || eventStatus === 'blocked' || nodeStatus === 'failed' || nodeStatus === 'blocked')
  const isPartial = eventName === 'subagent.complete' && (eventStatus === 'partial' || nodeStatus === 'partial' || groundingStatus === 'partial' || groundingStatus === 'truncated')
  const isUnsafe = eventName === 'subagent.complete' && (!isFailure && !isClarify && (groundingStatus === 'unsafe_to_finalize' || groundingStatus === 'unverified' || finalizable === false))
  const shouldGateDependents = isFailure || isPartial || isUnsafe || eventName === 'subagent.result_rejected' || eventName === 'subagent.finalization_blocked'
  const blockedPlanNodeIds = shouldGateDependents
    ? resolveBlockedPlanNodeIds(snapshot, payload, targetNodeId)
    : []
  const blockedPlanNodeIdSet = new Set(blockedPlanNodeIds)
  const dependencyGateReason = textValue(payload.dependency_gate_reason || payload.reason || payload.summary || payload.text)
  const completionNodeStatus: NodeStatus = isFailure
    ? 'failed'
    : isUnsafe
      ? 'unsafe'
      : isPartial
        ? 'partial'
        : 'done'
  const completionOutcome: NodeOutcome = completionNodeStatus === 'done'
    ? 'success'
    : completionNodeStatus === 'partial'
      ? 'partial'
      : completionNodeStatus === 'unsafe'
        ? 'unsafe'
        : 'failure'
  const preview = eventName === 'subagent.task_sent'
    ? (text || summary || goal || '主智能体已下发子任务')
    : eventName === 'subagent.task_accepted'
      ? (text || summary || goal || '子智能体已接单')
      : eventName === 'subagent.start'
        ? (goal || '子任务已启动')
        : eventName === 'subagent.tool'
          ? `${toolName ? `调用工具 ${toolName}` : '调用工具'}${text ? `：${text}` : ''}`
          : eventName === 'subagent.clarify_required'
            ? (text || summary || textValue(payload.question) || '等待用户补充信息')
            : eventName === 'subagent.progress'
              ? (text || '子任务执行中')
              : eventName === 'subagent.artifact_published'
                ? (summary || text || '节点产物已发布')
                : eventName === 'subagent.result_received'
                  ? (summary || text || '主智能体已收到节点回执')
                  : eventName === 'subagent.result_rejected'
                    ? (summary || text || '当前节点结果未通过汇总校验')
                    : eventName === 'subagent.finalization_blocked'
                      ? (text || textValue(payload.reason) || '最终汇总已被阻断')
                      : (summary || text || goal || '子任务已完成')

  const shouldLockNode = eventName === 'subagent.complete'
    || eventName === 'subagent.result_rejected'
    || eventName === 'subagent.finalization_blocked'
  let next = normalizeSingleRunningNode(snapshot, shouldLockNode ? null : targetNodeId)
  next = {
    ...next,
    text: preview || next.text,
    currentNodeId: shouldLockNode
      ? next.currentNodeId
      : targetNodeId,
    planNodes: next.planNodes.map(node => {
      if (node.id === 'understand' || node.id === 'route') {
        return { ...node, status: 'done', outcome: 'success' }
      }
      if (blockedPlanNodeIdSet.has(node.id)) {
        const shouldInvalidate = node.status === 'done'
          || node.status === 'doing'
          || node.status === 'partial'
          || node.status === 'unsafe'
        const nextStatus: NodeStatus = node.status === 'failed'
          ? 'failed'
          : shouldInvalidate
            ? 'invalidated'
            : 'waiting_replan'
        return {
          ...node,
          status: nextStatus,
          outcome: 'failure',
          summary: dependencyGateReason
            ? node.status === 'failed'
              ? (node.summary || `前置节点失败或不可最终化：${dependencyGateReason}。当前节点已暂停。`)
              : shouldInvalidate
              ? `前置节点失败或不可最终化：${dependencyGateReason}。当前节点已有旧结果已失效，等待重新规划。`
              : `前置节点失败或不可最终化：${dependencyGateReason}。当前节点没有合法输入，已暂停并等待重新规划。`
            : node.status === 'failed'
              ? (node.summary || '当前节点已失败。')
              : shouldInvalidate
              ? '前置节点失败或不可最终化，当前节点已有旧结果已失效，等待重新规划。'
              : '前置节点失败或不可最终化，当前节点没有合法输入，已暂停并等待重新规划。',
        }
      }
      if (node.id !== targetNodeId) return node
      if (eventName === 'subagent.complete') {
        return {
          ...node,
          status: completionNodeStatus,
          outcome: completionOutcome,
          summary: summary || text || goal || node.summary,
          executor: {
            type: 'subagent',
            id: subagentId || node.executor.id,
            name: agentName || node.executor.name,
          },
        }
      }
      if (eventName === 'subagent.result_rejected' || eventName === 'subagent.finalization_blocked') {
        return {
          ...node,
          status: isUnsafe ? 'unsafe' : 'partial',
          outcome: isUnsafe ? 'unsafe' : 'partial',
          summary: summary || text || textValue(payload.reason) || goal || node.summary,
          executor: {
            type: 'subagent',
            id: subagentId || node.executor.id,
            name: agentName || node.executor.name,
          },
        }
      }
      return {
        ...node,
        status: 'doing',
        outcome: 'unknown',
        summary: summary || text || goal || preview || node.summary,
        executor: {
          type: 'subagent',
          id: subagentId || node.executor.id,
          name: agentName || node.executor.name,
        },
      }
    }),
  }
  if (blockedPlanNodeIds.length > 0) {
    const blockedTitles = next.planNodes
      .filter(node => blockedPlanNodeIdSet.has(node.id))
      .map(node => node.title)
      .filter(Boolean)
    next = appendActivity(next, {
      id: `route:dependency-gate:${targetNodeId}:${Date.now()}`,
      kind: 'route',
      title: '暂停后续节点',
      text: blockedTitles.length > 0
        ? `由于前置节点未完成，${blockedTitles.join('、')} 已暂停，等待重新规划。`
        : '由于前置节点未完成，后续依赖节点已暂停，等待重新规划。',
      status: 'error',
      timestamp: Date.now(),
      agentId: subagentId || undefined,
      agentName: agentName || undefined,
    })
  }
  next = appendActivity(next, {
    id: `${eventName}:${subagentId || 'subagent'}:${Date.now()}`,
    kind: eventName,
    title: eventName === 'subagent.task_sent'
      ? '主智能体下发任务'
      : eventName === 'subagent.task_accepted'
        ? '子智能体接单'
        : eventName === 'subagent.start'
          ? '子智能体启动'
          : eventName === 'subagent.tool'
            ? `工具调用${toolName ? `：${toolName}` : ''}`
            : eventName === 'subagent.clarify_required'
              ? '等待用户补充'
              : eventName === 'subagent.progress'
                ? '执行进展'
                : eventName === 'subagent.artifact_published'
                  ? '发布 artifact'
                  : eventName === 'subagent.result_received'
                    ? '收到节点回执'
                    : eventName === 'subagent.result_rejected'
                      ? '拒绝直接汇总'
                      : eventName === 'subagent.finalization_blocked'
                        ? '阻断最终汇总'
                        : (isFailure ? '子智能体失败' : isPartial ? '子智能体部分完成' : isUnsafe ? '结果不可直接汇总' : '子智能体完成'),
    text: summary || text || textValue(payload.question) || goal || preview,
    status: eventName === 'subagent.complete'
      ? (isFailure ? 'error' : isPartial || isUnsafe ? 'info' : 'done')
      : eventName === 'subagent.result_rejected' || eventName === 'subagent.finalization_blocked'
        ? 'info'
      : eventName === 'subagent.clarify_required'
        ? 'info'
      : 'running',
    timestamp: Date.now(),
    agentId: subagentId || undefined,
    agentName: agentName || undefined,
    toolName: toolName || undefined,
    output: eventName === 'subagent.complete' ? summary || text || preview : undefined,
  })

  if (eventName === 'subagent.complete') {
    if (isFailure) {
      return {
        ...next,
        status: 'running',
        currentNodeId: targetNodeId,
      }
    }
    if (isPartial || isUnsafe) {
      return {
        ...next,
        status: 'running',
        currentNodeId: targetNodeId,
      }
    }
    const nextNodeId = nextReadyNodeId(next, new Set([targetNodeId]))
    if (nextNodeId) {
      return {
        ...next,
        currentNodeId: nextNodeId,
      }
    }
    return {
      ...next,
      currentNodeId: 'respond',
      planNodes: next.planNodes.map(node => node.id === 'respond'
        ? { ...node, status: 'doing', outcome: 'unknown', summary: '子智能体已返回阶段成果，主智能体正在组织最终回复。' }
        : node),
    }
  }

  if (eventName === 'subagent.clarify_required') {
    return {
      ...next,
      status: 'running',
      currentNodeId: targetNodeId,
      text: preview || next.text,
    }
  }

  if (eventName === 'subagent.result_rejected' || eventName === 'subagent.finalization_blocked') {
    return {
      ...next,
      status: 'running',
      currentNodeId: targetNodeId,
      text: preview || next.text,
    }
  }

  return next
}

export function applyTerminalEvent(
  snapshot: CollaborationSnapshotState,
  outcome: 'completed' | 'failed',
  payload: Record<string, unknown> = {},
): CollaborationSnapshotState {
  const nextNodes = snapshot.planNodes.map(node => {
    if (outcome === 'completed') {
      if (
        node.status === 'blocked'
        || node.status === 'partial'
        || node.status === 'unsafe'
        || node.status === 'failed'
        || node.status === 'waiting_replan'
        || node.status === 'invalidated'
        || node.status === 'skipped'
      ) return node
      if (node.id === 'respond') {
        return {
          ...node,
          status: 'done' as const,
          outcome: 'success' as const,
          summary: '主智能体已汇总阶段成果并回复用户。',
        }
      }
      return {
        ...node,
        status: 'done' as const,
        outcome: 'success' as const,
      }
    }
    if (node.status === 'waiting_replan') {
      return {
        ...node,
        status: 'skipped' as const,
        outcome: 'failure' as const,
        summary: node.summary || '本轮恢复未完成，当前节点已跳过。',
      }
    }
    if (node.id === 'respond' && node.status === 'doing') {
      return {
        ...node,
        status: 'skipped' as const,
        outcome: 'failure' as const,
        summary: node.summary || '由于前置节点失败，本轮不再进入最终汇总。',
      }
    }
    if (node.id === snapshot.currentNodeId) {
      if (
        node.status === 'partial'
        || node.status === 'unsafe'
        || node.status === 'failed'
        || node.status === 'invalidated'
        || node.status === 'skipped'
      ) return node
      return {
        ...node,
        status: 'failed' as const,
        outcome: 'failure' as const,
      }
    }
    if (node.status === 'doing') {
      return {
        ...node,
        status: 'invalidated' as const,
        outcome: 'failure' as const,
        summary: node.summary || '本轮执行已终止，当前节点结果已失效。',
      }
    }
    return node
  })
  const base = {
    ...snapshot,
    status: outcome,
    currentNodeId: outcome === 'completed' ? 'respond' : snapshot.currentNodeId,
    text: summarizeText(payload.output || payload.error || snapshot.text, 260) || snapshot.text,
    reason: outcome === 'failed'
      ? summarizeText(payload.error || snapshot.reason, 260) || snapshot.reason
      : snapshot.reason,
    planNodes: nextNodes,
    thinkingSteps: snapshot.thinkingSteps.map(step => ({
      ...step,
      status: step.status === 'running' ? 'done' : step.status,
    })),
    endedAt: Date.now(),
  }
  return appendActivity(base, {
    id: `route:terminal:${outcome}:${Date.now()}`,
    kind: 'route',
    title: outcome === 'completed' ? '主智能体完成汇总' : '执行失败',
    text: outcome === 'completed'
      ? '本轮任务已结束，最终回复已返回到对话区。'
      : summarizeText(payload.error || '任务执行中断，请先处理失败节点或工具异常。', 220),
    status: outcome === 'completed' ? 'done' : 'error',
    timestamp: Date.now(),
  })
}
