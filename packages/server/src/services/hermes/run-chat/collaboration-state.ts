type SnapshotStatus = 'idle' | 'running' | 'completed' | 'failed'
type NodeStatus = 'todo' | 'doing' | 'done' | 'blocked'
type ThinkingStatus = 'pending' | 'running' | 'done'

export interface CollaborationSnapshotNode {
  id: string
  title: string
  phase: string
  status: NodeStatus
  dependsOn: string[]
  executor: {
    type: 'hermes' | 'subagent'
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
  mode: 'delegate_subagent' | 'hermes_native'
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
  return value === 'todo' || value === 'doing' || value === 'done' || value === 'blocked'
    ? value
    : fallback
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
  mode: 'delegate_subagent' | 'hermes_native'
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
      dependsOn: index > 0 ? [routeTodoNodeId(index - 1)] : [],
      executor: delegated
        ? {
            type: 'subagent',
            id: args.selectedAgentId || undefined,
            name: args.selectedAgentName || '子智能体',
          }
        : {
            type: 'hermes',
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
        dependsOn: [],
        executor: { type: 'hermes', name: '主智能体' },
        summary: '已接收用户需求并提取当前任务目标。',
      },
      {
        id: 'route',
        title: '确认执行路径',
        phase: '路由',
        status: taskNodes.length > 0 ? 'doing' : 'done',
        dependsOn: ['understand'],
        executor: { type: 'hermes', name: '主智能体' },
        summary: args.routeText || '主智能体已生成任务路径。',
      },
      ...taskNodes,
      {
        id: 'respond',
        title: '汇总阶段成果并回复用户',
        phase: '汇总',
        status: taskNodes.length > 0 ? 'todo' : 'doing',
        dependsOn: taskNodes.length > 0 ? [taskNodes[taskNodes.length - 1]!.id] : ['route'],
        executor: { type: 'hermes', name: '主智能体' },
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

function normalizePlanNodes(payload: Record<string, unknown>, mode: 'delegate_subagent' | 'hermes_native', selectedAgentId: string, selectedAgentName: string, routeText: string) {
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
    dependsOn: dependsOnMap.get(nodeIds[index]) || [],
    executor: node.executor && typeof node.executor === 'object' && (node.executor as any).type === 'subagent'
      ? {
          type: 'subagent',
          id: textValue((node.executor as any).id) || undefined,
          name: textValue((node.executor as any).name) || selectedAgentName || '子智能体',
        }
      : {
          type: 'hermes',
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
    if (node.status === 'done' || node.status === 'blocked' || node.status === 'doing') continue
    const depsReady = (node.dependsOn || []).every(depId => {
      const dep = snapshot.planNodes.find(item => item.id === depId)
      return !dep || dep.status === 'done'
    })
    if (depsReady) return node.id
  }
  return null
}

function normalizeSingleRunningNode(snapshot: CollaborationSnapshotState, runningNodeId: string | null): CollaborationSnapshotState {
  return {
    ...snapshot,
    planNodes: snapshot.planNodes.map(node => {
      if (RESERVED_NODE_IDS.has(node.id)) return node
      if (runningNodeId && node.id === runningNodeId) return { ...node, status: 'doing' }
      if (node.status === 'doing') return { ...node, status: 'todo' }
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
      && node.status !== 'done'
      && node.status !== 'blocked',
    )
    if (candidate) return candidate.id
  }
  return nextReadyNodeId(snapshot) || snapshot.currentNodeId || 'respond'
}

export function createCollaborationSnapshot(args: {
  runId: string
  sessionId: string
  objective: string
  mode?: 'delegate_subagent' | 'hermes_native'
}): CollaborationSnapshotState {
  return {
    runId: args.runId,
    sessionId: args.sessionId,
    mode: args.mode || 'hermes_native',
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
        dependsOn: [],
        executor: { type: 'hermes', name: '主智能体' },
        summary: '主智能体正在读取消息、提取目标与约束。',
      },
      {
        id: 'route',
        title: '确认执行路径',
        phase: '路由',
        status: 'todo',
        dependsOn: ['understand'],
        executor: { type: 'hermes', name: '主智能体' },
        summary: '等待主智能体完成意图分析与任务拆解。',
      },
      {
        id: 'respond',
        title: '汇总阶段成果并回复用户',
        phase: '汇总',
        status: 'todo',
        dependsOn: ['route'],
        executor: { type: 'hermes', name: '主智能体' },
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
  const mode = payload.mode === 'delegate_subagent' ? 'delegate_subagent' : 'hermes_native'
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
  const preview = eventName === 'subagent.start'
    ? (goal || '子任务已启动')
    : eventName === 'subagent.tool'
      ? `${toolName ? `调用工具 ${toolName}` : '调用工具'}${text ? `：${text}` : ''}`
      : eventName === 'subagent.progress'
        ? (text || '子任务执行中')
        : (summary || text || goal || '子任务已完成')

  let next = normalizeSingleRunningNode(snapshot, eventName === 'subagent.complete' ? null : targetNodeId)
  next = {
    ...next,
    text: preview || next.text,
    currentNodeId: eventName === 'subagent.complete'
      ? next.currentNodeId
      : targetNodeId,
    planNodes: next.planNodes.map(node => {
      if (node.id === 'understand' || node.id === 'route') {
        return { ...node, status: 'done' }
      }
      if (node.id !== targetNodeId) return node
      if (eventName === 'subagent.complete') {
        const failed = textValue(payload.status) && textValue(payload.status) !== 'completed'
        return {
          ...node,
          status: failed ? 'blocked' : 'done',
          summary: summary || text || goal || node.summary,
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
        summary: summary || text || goal || preview || node.summary,
        executor: {
          type: 'subagent',
          id: subagentId || node.executor.id,
          name: agentName || node.executor.name,
        },
      }
    }),
  }
  next = appendActivity(next, {
    id: `${eventName}:${subagentId || 'subagent'}:${Date.now()}`,
    kind: eventName,
    title: eventName === 'subagent.start'
      ? '子智能体启动'
      : eventName === 'subagent.tool'
        ? `工具调用${toolName ? `：${toolName}` : ''}`
        : eventName === 'subagent.progress'
          ? '执行进展'
          : (textValue(payload.status) && textValue(payload.status) !== 'completed' ? '子智能体失败' : '子智能体完成'),
    text: summary || text || goal || preview,
    status: eventName === 'subagent.complete'
      ? (textValue(payload.status) && textValue(payload.status) !== 'completed' ? 'error' : 'done')
      : 'running',
    timestamp: Date.now(),
    agentId: subagentId || undefined,
    agentName: agentName || undefined,
    toolName: toolName || undefined,
    output: eventName === 'subagent.complete' ? summary || text || preview : undefined,
  })

  if (eventName === 'subagent.complete') {
    const failed = textValue(payload.status) && textValue(payload.status) !== 'completed'
    if (failed) {
      return {
        ...next,
        status: 'failed',
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
      planNodes: next.planNodes.map(node => node.id === 'respond' ? { ...node, status: 'doing', summary: '子智能体已返回阶段成果，主智能体正在组织最终回复。' } : node),
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
      if (node.status === 'blocked') return node
      if (node.id === 'respond') {
        return {
          ...node,
          status: 'done' as const,
          summary: '主智能体已汇总阶段成果并回复用户。',
        }
      }
      return {
        ...node,
        status: 'done' as const,
      }
    }
    if (node.id === snapshot.currentNodeId) return { ...node, status: 'blocked' as const }
    if (node.id === 'respond' && node.status === 'doing') return { ...node, status: 'blocked' as const }
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
