<script setup lang="ts">
import type {
  MultiAgentRouteState,
  MultiAgentWorkflowMessageState,
} from "@/stores/hermes/chat"
import { computed, ref } from "vue"

type PlannerStep = {
  id: string
  title: string
  detail: string
  status: "pending" | "running" | "done" | "error"
}

type ExecutionTask = {
  id: string
  index: number
  phase: string
  title: string
  summary: string
  dependsOn: string[]
  executorType: "hermes" | "subagent"
  agentId: string
  agentName: string
  status: "todo" | "doing" | "done" | "blocked"
}

type TodoEntry = {
  id: string
  index: number
  title: string
  detail: string
  dependsOn: string[]
  agentName: string
  executorType: "hermes" | "subagent"
  status: "pending" | "running" | "done" | "error"
}

type PlanCardStep = {
  id: string
  title: string
  detail: string
  status: "pending" | "running" | "done" | "error"
}

type CanvasNodeLayout = {
  id: string
  task: ExecutionTask
  top: number
  left: number
  width: number
}

type CanvasEdgeLayout = {
  id: string
  path: string
  tone: "blue" | "green" | "gray" | "red"
  animated: boolean
}

type HistoryRunEntry = {
  runId: string
  objective: string
  status: "idle" | "running" | "completed" | "failed"
  startedAt: number
  endedAt: number | null
}

const CANVAS_MIN_HEIGHT = 268
const CANVAS_NODE_HEIGHT = 84
const CANVAS_TOP_PADDING = 20
const CANVAS_BOTTOM_PADDING = 24
const CANVAS_LEVEL_GAP = 112

const props = defineProps<{
  route: MultiAgentRouteState | null
  workflowSnapshot?: MultiAgentWorkflowMessageState | null
  tasks: ExecutionTask[]
  todoSteps: PlannerStep[]
  statusText: string
  primaryActorText: string
  objectiveLines: string[]
  historyRuns?: HistoryRunEntry[]
  selectedRunId?: string
}>()

const emit = defineEmits<{
  close: []
  selectRun: [runId: string]
}>()

const planExpanded = ref(false)
const canvasExpanded = ref(true)
const historyExpanded = ref(false)

const hasWorkflowData = computed(() => !!props.route || !!props.workflowSnapshot)

const effectiveRouteState = computed<"idle" | "running" | "completed" | "failed">(() => {
  if (props.route?.status) return props.route.status
  if (props.workflowSnapshot?.status === "done") return "completed"
  if (props.workflowSnapshot?.status === "error") return "failed"
  if (props.workflowSnapshot) return "running"
  return "idle"
})

const effectiveStatusText = computed(() => {
  if (props.route) return props.statusText
  if (props.workflowSnapshot?.status === "done") return "已完成"
  if (props.workflowSnapshot?.status === "error") return "执行失败"
  if (props.workflowSnapshot) return "任务执行中..."
  return props.statusText || "等待任务"
})

const effectiveObjectiveText = computed(() => {
  if (props.objectiveLines.length) return props.objectiveLines.join("\n")
  return props.route?.objective
    || props.route?.reason
    || props.route?.text
    || props.workflowSnapshot?.objective
    || "主智能体正在整理本轮任务目标。"
})

const effectiveReasoningText = computed(() => {
  const workflowReasoning = (props.workflowSnapshot?.reasoningText || "").trim()
  if (workflowReasoning) return workflowReasoning

  const routeReasoning = (props.route?.activity || [])
    .filter(item => item.kind === "route" && item.text)
    .map(item => item.text.trim())
    .filter(Boolean)
    .slice(-4)
    .join("\n")
  if (routeReasoning) return routeReasoning

  return (props.workflowSnapshot?.current || props.route?.text || "").trim()
})

const effectiveReasoningDisplayText = computed(() => {
  const text = effectiveReasoningText.value
  if (!text) return ""
  return text.replace(/([。！？!?])\s*/g, "$1\n")
})

const effectiveTodoEntries = computed<TodoEntry[]>(() => {
  if (props.tasks.length > 0) {
    return props.tasks.map(task => ({
      id: task.id,
      index: task.index,
      title: task.title,
      detail: task.summary || "等待执行。",
      dependsOn: task.dependsOn || [],
      agentName: task.agentName || "",
      executorType: task.executorType,
      status: task.status === "done"
        ? "done"
        : task.status === "doing"
          ? "running"
          : task.status === "blocked"
            ? "error"
            : "pending",
    }))
  }

  if (!props.todoSteps.length) return []
  return props.todoSteps.map((step, index) => ({
    id: step.id,
    index: index + 1,
    title: step.title,
    detail: step.detail,
    dependsOn: index > 0 ? [props.todoSteps[index - 1]?.id || ""].filter(Boolean) : [],
    agentName: "",
    executorType: "hermes",
    status: step.status === "error"
      ? "error"
      : step.status === "running"
        ? "running"
        : step.status === "done"
          ? "done"
          : "pending",
  }))
})

const todoDoneCount = computed(() =>
  effectiveTodoEntries.value.filter(entry => entry.status === "done").length,
)

const completedPlanCount = computed(() =>
  planCardSteps.value.filter(step => step.status === "done").length,
)

const historyRuns = computed(() => props.historyRuns || [])

const planHeadlineText = computed(() => {
  if (effectiveRouteState.value === "failed") return "标准执行计划 (执行失败)"
  if (completedPlanCount.value === planCardSteps.value.length) return "标准执行计划 (已完成)"
  if (hasWorkflowData.value) return "标准执行计划 (执行中)"
  return "标准执行计划"
})

function plannerStatusLabel(status: TodoEntry["status"]) {
  switch (status) {
    case "done":
      return "已完成"
    case "running":
      return "执行中..."
    case "error":
      return "失败"
    default:
      return "等待执行"
  }
}

function todoAgentLabel(entry: TodoEntry) {
  if (entry.executorType === "subagent" && entry.agentName) return entry.agentName
  if (entry.agentName) return entry.agentName
  if (/(汇总|回复|摘要)/.test(entry.title)) return "总结智能体"
  if (/(转交|路由|匹配|规划)/.test(entry.title)) return "路由智能体"
  return "主智能体"
}

function normalizePlanStatus(status?: string): PlanCardStep["status"] {
  if (status === "done") return "done"
  if (status === "running") return "running"
  if (status === "error") return "error"
  return "pending"
}

const thinkingStepStatusMap = computed(() =>
  new Map((props.route?.thinkingSteps || []).map(step => [step.id, step.status])),
)

const workflowStepStatusMap = computed(() =>
  new Map((props.workflowSnapshot?.steps || []).map(step => [step.id, step.status])),
)

function resolveFixedPlanStatus(stepId: "understand" | "route"): PlanCardStep["status"] {
  const routeStatus = thinkingStepStatusMap.value.get(stepId)
  if (routeStatus) return normalizePlanStatus(routeStatus)
  const workflowStatus = workflowStepStatusMap.value.get(stepId)
  return normalizePlanStatus(workflowStatus)
}

const hasGeneratedTodo = computed(() => effectiveTodoEntries.value.length > 0)

const effectiveCanvasTasks = computed<ExecutionTask[]>(() => {
  if (props.tasks.length > 0) return props.tasks
  if (props.todoSteps.length === 0) return []
  return effectiveTodoEntries.value.map((entry) => ({
    id: entry.id,
    index: entry.index,
    phase: "",
    title: entry.title,
    summary: entry.detail,
    dependsOn: entry.dependsOn || [],
    executorType: entry.executorType,
    agentId: "",
    agentName: entry.agentName,
    status: entry.status === "done"
      ? "done"
      : entry.status === "running"
        ? "doing"
        : entry.status === "error"
          ? "blocked"
          : "todo",
  }))
})

const planCardSteps = computed<PlanCardStep[]>(() => {
  const intentStatus = resolveFixedPlanStatus("understand")
  const decomposeStatus = resolveFixedPlanStatus("route")
  const todoStatus: PlanCardStep["status"] = hasGeneratedTodo.value
    ? "done"
    : (decomposeStatus === "done" || props.route?.currentNodeId === "route")
        ? "running"
        : "pending"
  const canvasStatus: PlanCardStep["status"] = effectiveRouteState.value === "failed"
    ? "error"
    : effectiveCanvasTasks.value.length > 0
      ? "done"
      : todoStatus === "done"
        ? "running"
        : "pending"

  return [
    {
      id: "intent",
      title: "意图识别",
      detail: "确认用户目标与约束条件。",
      status: intentStatus,
    },
    {
      id: "decompose",
      title: "任务拆解",
      detail: "生成多智能体协作任务拆解计划。",
      status: decomposeStatus,
    },
    {
      id: "todo",
      title: "Todo生成",
      detail: "形成可执行任务清单。",
      status: todoStatus,
    },
    {
      id: "canvas",
      title: "绘制节点",
      detail: "将任务清单同步为执行节点画布。",
      status: canvasStatus,
    },
  ]
})

const visibleCanvasTasks = computed(() => effectiveCanvasTasks.value.slice(0, 6))

const canvasDependencyPairs = computed(() => {
  const tasks = visibleCanvasTasks.value
  const visibleIds = new Set(tasks.map(task => task.id))
  const pairs = tasks.flatMap(task =>
    (task.dependsOn || [])
      .filter(dependsOn => visibleIds.has(dependsOn))
      .map(dependsOn => ({ from: dependsOn, to: task.id })),
  )

  if (pairs.length > 0) return pairs
  return tasks.slice(1).map((task, index) => ({
    from: tasks[index].id,
    to: task.id,
  }))
})

const canvasHeight = computed(() => {
  const taskCount = visibleCanvasTasks.value.length
  if (taskCount <= 1) return CANVAS_MIN_HEIGHT

  const levelCount = (() => {
    const levelMap = new Map<string, number>()
    const depsById = new Map(visibleCanvasTasks.value.map(task => [task.id, task.dependsOn || []]))
    const resolveLevel = (id: string, trail = new Set<string>()): number => {
      if (levelMap.has(id)) return levelMap.get(id) || 0
      if (trail.has(id)) return 0
      const deps = (depsById.get(id) || []).filter(dep => depsById.has(dep))
      if (deps.length === 0) {
        levelMap.set(id, 0)
        return 0
      }
      const nextTrail = new Set(trail)
      nextTrail.add(id)
      const level = Math.max(...deps.map(dep => resolveLevel(dep, nextTrail))) + 1
      levelMap.set(id, level)
      return level
    }
    visibleCanvasTasks.value.forEach(task => resolveLevel(task.id))
    return Math.max(1, ...levelMap.values()) + 1
  })()

  return Math.max(
    CANVAS_MIN_HEIGHT,
    CANVAS_TOP_PADDING + CANVAS_BOTTOM_PADDING + CANVAS_NODE_HEIGHT + (levelCount - 1) * CANVAS_LEVEL_GAP,
  )
})

const canvasNodes = computed<CanvasNodeLayout[]>(() => {
  const tasks = visibleCanvasTasks.value
  if (tasks.length === 0) return []

  const depsById = new Map(tasks.map(task => [task.id, (task.dependsOn || []).filter(dep => tasks.some(item => item.id === dep))]))
  const levelMap = new Map<string, number>()
  const resolveLevel = (id: string, trail = new Set<string>()): number => {
    if (levelMap.has(id)) return levelMap.get(id) || 0
    if (trail.has(id)) return 0
    const deps = depsById.get(id) || []
    if (deps.length === 0) {
      levelMap.set(id, 0)
      return 0
    }
    const nextTrail = new Set(trail)
    nextTrail.add(id)
    const level = Math.max(...deps.map(dep => resolveLevel(dep, nextTrail))) + 1
    levelMap.set(id, level)
    return level
  }

  tasks.forEach(task => resolveLevel(task.id))

  const layers = new Map<number, ExecutionTask[]>()
  tasks.forEach((task) => {
    const level = levelMap.get(task.id) || 0
    const bucket = layers.get(level) || []
    bucket.push(task)
    layers.set(level, bucket)
  })

  const orderedLevels = [...layers.keys()].sort((left, right) => left - right)
  const rowGap = orderedLevels.length > 1
    ? (canvasHeight.value - CANVAS_TOP_PADDING - CANVAS_BOTTOM_PADDING - CANVAS_NODE_HEIGHT) / (orderedLevels.length - 1)
    : 0

  return orderedLevels.flatMap((level, rowIndex) => {
    const row = layers.get(level) || []
    const width = row.length >= 3 ? 118 : 138
    return row.map((task, columnIndex) => {
      const left = row.length === 1
        ? 50
        : row.length === 2
          ? [30, 70][columnIndex] || 50
          : 16 + (68 / Math.max(1, row.length - 1)) * columnIndex
      return {
        id: task.id,
        task,
        top: Math.round(CANVAS_TOP_PADDING + rowIndex * rowGap),
        left,
        width,
      }
    })
  })
})

const canvasNodeMap = computed(() =>
  new Map(canvasNodes.value.map(node => [node.id, node])),
)

function edgeTone(status: ExecutionTask["status"]): CanvasEdgeLayout["tone"] {
  if (status === "blocked") return "red"
  if (status === "doing") return "blue"
  if (status === "done") return "green"
  return "gray"
}

const canvasEdges = computed<CanvasEdgeLayout[]>(() => {
  const taskMap = new Map(visibleCanvasTasks.value.map(task => [task.id, task]))
  return canvasDependencyPairs.value
    .map((pair) => {
      const fromNode = canvasNodeMap.value.get(pair.from)
      const toNode = canvasNodeMap.value.get(pair.to)
      const targetTask = taskMap.get(pair.to)
      if (!fromNode || !toNode || !targetTask) return null

      const startX = fromNode.left
      const startY = fromNode.top + CANVAS_NODE_HEIGHT
      const endX = toNode.left
      const endY = toNode.top
      const deltaY = Math.max(40, endY - startY)
      const sameColumn = Math.abs(startX - endX) < 4
      const controlOffset = Math.max(24, deltaY * 0.42)
      const firstControlX = sameColumn ? startX : startX + (endX - startX) * 0.18
      const secondControlX = sameColumn ? endX : endX - (endX - startX) * 0.18

      return {
        id: `edge:${pair.from}:${pair.to}`,
        path: `M ${startX} ${startY} C ${firstControlX} ${startY + controlOffset}, ${secondControlX} ${endY - controlOffset}, ${endX} ${endY}`,
        tone: edgeTone(targetTask.status),
        animated: targetTask.status === "doing",
      }
    })
    .filter((item): item is CanvasEdgeLayout => Boolean(item))
})

function canvasNodeStateLabel(status: ExecutionTask["status"]) {
  switch (status) {
    case "done":
      return "已完成"
    case "doing":
      return "执行中..."
    case "blocked":
      return "失败"
    default:
      return "等待中"
  }
}

function historyStatusLabel(status: HistoryRunEntry["status"]) {
  switch (status) {
    case "completed":
      return "已完成"
    case "failed":
      return "失败"
    case "running":
      return "执行中"
    default:
      return "待命"
  }
}

function historyStatusClass(status: HistoryRunEntry["status"]) {
  return status === "completed"
    ? "is-done"
    : status === "failed"
      ? "is-error"
      : status === "running"
        ? "is-running"
        : "is-pending"
}

function formatHistoryTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return ""
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}
</script>

<template>
  <aside
    class="multi-agent-sidebar"
    aria-label="多智能体协作规划"
    data-testid="multi-agent-panel"
  >
    <div class="multi-agent-sidebar-head">
      <div class="multi-agent-sidebar-title">
        <div class="multi-agent-sidebar-icon">
          <span class="multi-agent-sidebar-icon-ring"></span>
          <svg
            class="multi-agent-sidebar-icon-svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="5" cy="12" r="2.2" />
            <circle cx="19" cy="7" r="2.2" />
            <circle cx="19" cy="17" r="2.2" />
            <path d="M7.2 11.2 16.8 7.8" />
            <path d="M7.2 12.8 16.8 16.2" />
          </svg>
        </div>
        <div class="multi-agent-sidebar-copy">
          <h2>多智能体协作模式</h2>
          <span>{{ effectiveStatusText }}</span>
        </div>
      </div>

      <button class="multi-agent-sidebar-close" type="button" @click="emit('close')">
        关闭
      </button>
    </div>

    <div class="multi-agent-sidebar-body">
      <div v-if="!hasWorkflowData" class="multi-agent-empty" data-testid="multi-agent-placeholder">
        <strong>多智能体协作已开启</strong>
        <span>发送需求后，这里会展示任务目标、固定计划、Todo 清单和执行画布。</span>
      </div>

      <template v-else>
        <section class="multi-agent-section">
          <h3 class="multi-agent-section-label">任务目标</h3>
          <p class="multi-agent-objective">{{ effectiveObjectiveText }}</p>
        </section>

        <section v-if="historyRuns.length > 1" class="multi-agent-section">
          <button
            class="multi-agent-canvas-title"
            type="button"
            data-testid="multi-agent-history-toggle"
            @click="historyExpanded = !historyExpanded"
          >
            <div class="multi-agent-canvas-title-copy">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 8v5l3 2" />
                <circle cx="12" cy="12" r="9" />
              </svg>
              <h3>协作历史</h3>
            </div>
            <svg
              class="multi-agent-chevron"
              :class="{ rotated: historyExpanded }"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          <div v-if="historyExpanded" class="multi-agent-history-list">
            <button
              v-for="item in historyRuns"
              :key="item.runId"
              class="multi-agent-history-item"
              :class="{ active: item.runId === (selectedRunId || '') }"
              type="button"
              @click="emit('selectRun', item.runId)"
            >
              <div class="multi-agent-history-copy">
                <strong>{{ item.objective }}</strong>
                <span>{{ formatHistoryTime(item.startedAt) }}</span>
              </div>
              <small :class="historyStatusClass(item.status)">{{ historyStatusLabel(item.status) }}</small>
            </button>
          </div>
        </section>

        <section v-if="effectiveReasoningDisplayText" class="multi-agent-section">
          <div class="multi-agent-subhead compact">
            <h3>规划过程</h3>
            <span>{{ primaryActorText }}</span>
          </div>
          <div class="multi-agent-reasoning-box">{{ effectiveReasoningDisplayText }}</div>
        </section>

        <section class="multi-agent-section">
          <div class="multi-agent-plan-card" :class="{ expanded: planExpanded }">
            <button
              class="multi-agent-plan-toggle"
              type="button"
              data-testid="multi-agent-plan-toggle"
              @click="planExpanded = !planExpanded"
            >
              <div class="multi-agent-plan-toggle-copy">
                <span class="multi-agent-plan-toggle-icon">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 10.5 8 14.5 16 6.5" />
                  </svg>
                </span>
                <h3>{{ planHeadlineText }}</h3>
              </div>
              <svg
                class="multi-agent-chevron"
                :class="{ rotated: planExpanded }"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <div v-if="planExpanded" class="multi-agent-plan-body">
              <div class="multi-agent-plan-line"></div>
              <article
                v-for="step in planCardSteps"
                :key="step.id"
                class="multi-agent-plan-step"
                :class="`is-${step.status}`"
              >
                <span class="multi-agent-plan-step-icon">
                  <span v-if="step.status === 'running'" class="multi-agent-spinner"></span>
                  <svg
                    v-else-if="step.status === 'done'"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M4 10.5 8 14.5 16 6.5" />
                  </svg>
                  <span v-else-if="step.status === 'error'" class="multi-agent-error-mark">!</span>
                  <span v-else class="multi-agent-plan-step-dot"></span>
                </span>
                <div class="multi-agent-plan-step-copy">
                  <strong>{{ step.title }}</strong>
                  <p>{{ step.detail }}</p>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section class="multi-agent-section">
          <div class="multi-agent-subhead">
            <h3>执行清单 (Todo List)</h3>
            <span>{{ effectiveTodoEntries.length ? `${todoDoneCount} / ${effectiveTodoEntries.length} 完成` : "等待生成" }}</span>
          </div>

          <div v-if="effectiveTodoEntries.length" class="multi-agent-todo-list">
            <div class="multi-agent-todo-line"></div>
            <article
              v-for="entry in effectiveTodoEntries"
              :key="entry.id"
              class="multi-agent-todo-item"
              :class="`is-${entry.status}`"
            >
              <span class="multi-agent-todo-index">
                <svg
                  v-if="entry.status === 'done'"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M4 10.5 8 14.5 16 6.5" />
                </svg>
                <span v-else-if="entry.status === 'running'" class="multi-agent-spinner"></span>
                <span v-else-if="entry.status === 'error'" class="multi-agent-error-mark">!</span>
                <span v-else>{{ entry.index }}</span>
              </span>

              <div class="multi-agent-todo-copy">
                <div class="multi-agent-todo-head">
                  <div class="multi-agent-todo-title">
                    <strong>{{ entry.index }}. {{ entry.title }}</strong>
                    <span class="multi-agent-agent-chip" :class="`is-${entry.executorType}`">
                      {{ todoAgentLabel(entry) }}
                    </span>
                  </div>
                  <small>{{ plannerStatusLabel(entry.status) }}</small>
                </div>
                <p>{{ entry.detail }}</p>
              </div>
            </article>
          </div>

          <div v-else class="multi-agent-empty minor">
            <span>等待主智能体生成执行清单。</span>
          </div>
        </section>

        <section class="multi-agent-section">
          <button
            class="multi-agent-canvas-title"
            type="button"
            data-testid="multi-agent-canvas-toggle"
            @click="canvasExpanded = !canvasExpanded"
          >
            <div class="multi-agent-canvas-title-copy">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
              <h3>执行节点画布</h3>
            </div>
            <svg
              class="multi-agent-chevron"
              :class="{ rotated: canvasExpanded }"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          <div
            v-if="canvasExpanded && visibleCanvasTasks.length"
            class="multi-agent-canvas"
            :style="{ height: `${canvasHeight}px` }"
          >
            <svg class="multi-agent-canvas-svg" :viewBox="`0 0 100 ${canvasHeight}`" preserveAspectRatio="none">
              <defs>
                <marker id="edge-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#93c5fd" />
                </marker>
                <marker id="edge-green" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#22c55e" />
                </marker>
                <marker id="edge-gray" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#cbd5e1" />
                </marker>
                <marker id="edge-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#fca5a5" />
                </marker>
              </defs>

              <path
                v-for="edge in canvasEdges"
                :key="edge.id"
                :d="edge.path"
                class="multi-agent-canvas-edge"
                :class="[`is-${edge.tone}`, { 'is-animated': edge.animated }]"
                :marker-end="`url(#edge-${edge.tone})`"
              />
            </svg>

            <article
              v-for="node in canvasNodes"
              :key="node.id"
              class="multi-agent-canvas-node"
              :class="`is-${node.task.status}`"
              :style="{
                top: `${node.top}px`,
                left: `${node.left}%`,
                width: `${node.width}px`,
                transform: 'translateX(-50%)',
              }"
            >
              <span class="multi-agent-canvas-node-badge">{{ node.task.index }}</span>
              <strong>{{ node.task.title }}</strong>
              <small>{{ todoAgentLabel({
                id: node.task.id,
                index: node.task.index,
                title: node.task.title,
                detail: node.task.summary,
                dependsOn: node.task.dependsOn,
                agentName: node.task.agentName,
                executorType: node.task.executorType,
                status: node.task.status === 'done' ? 'done' : node.task.status === 'doing' ? 'running' : node.task.status === 'blocked' ? 'error' : 'pending',
              }) }}</small>
              <span class="multi-agent-canvas-node-state">{{ canvasNodeStateLabel(node.task.status) }}</span>
            </article>
          </div>

          <div v-else class="multi-agent-empty minor">
            <span>等待主智能体生成执行节点。</span>
          </div>
        </section>
      </template>
    </div>
  </aside>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.multi-agent-sidebar {
  width: 380px;
  min-width: 380px;
  border-left: 1px solid rgba(15, 23, 42, 0.08);
  background: #f9fafb;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.multi-agent-sidebar-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  background: #fff;
  flex-shrink: 0;
}

.multi-agent-sidebar-title {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.multi-agent-sidebar-icon {
  position: relative;
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background: #eff6ff;
  color: #2563eb;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.12);
}

.multi-agent-sidebar-icon-ring {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #3b82f6;
  border: 2px solid #fff;
  box-shadow: 0 0 0 6px rgba(59, 130, 246, 0.08);
}

.multi-agent-sidebar-icon-svg {
  width: 16px;
  height: 16px;
}

.multi-agent-sidebar-copy {
  min-width: 0;

  h2 {
    margin: 0;
    font-size: 16px;
    line-height: 22px;
    color: var(--text-primary);
    font-weight: 700;
  }

  span {
    display: inline-block;
    margin-top: 4px;
    font-size: 12px;
    line-height: 18px;
    color: #2563eb;
    font-weight: 600;
  }
}

.multi-agent-sidebar-close {
  height: 32px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #fff;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  transition: background-color $transition-fast;

  &:hover {
    background: #f8fafc;
  }
}

.multi-agent-sidebar-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  scrollbar-width: thin;
}

.multi-agent-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.multi-agent-section-label {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--text-tertiary);
  font-weight: 600;
}

.multi-agent-objective {
  margin: 0;
  font-size: 13px;
  line-height: 22px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.multi-agent-empty {
  padding: 16px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--text-secondary);

  strong {
    font-size: 14px;
    line-height: 20px;
    color: var(--text-primary);
  }

  span {
    font-size: 13px;
    line-height: 20px;
  }

  &.minor {
    padding: 14px;
  }
}

.multi-agent-history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.multi-agent-history-item {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: #fff;
  border-radius: 12px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  text-align: left;
  cursor: pointer;
  transition: border-color $transition-fast, background-color $transition-fast;

  &:hover {
    border-color: rgba(59, 130, 246, 0.28);
    background: #f8fbff;
  }

  &.active {
    border-color: rgba(59, 130, 246, 0.28);
    background: #eff6ff;
  }

  small {
    font-size: 12px;
    line-height: 18px;
    font-weight: 600;
    white-space: nowrap;

    &.is-done { color: #16a34a; }
    &.is-error { color: #dc2626; }
    &.is-running { color: #2563eb; }
    &.is-pending { color: var(--text-tertiary); }
  }
}

.multi-agent-history-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;

  strong {
    font-size: 13px;
    line-height: 20px;
    color: var(--text-primary);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  span {
    font-size: 12px;
    line-height: 18px;
    color: var(--text-tertiary);
  }
}

.multi-agent-plan-card {
  border: 1px solid rgba(34, 197, 94, 0.28);
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 0 18px rgba(34, 197, 94, 0.08);
  overflow: hidden;
}

.multi-agent-plan-toggle,
.multi-agent-canvas-title {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  text-align: left;
  cursor: pointer;
}

.multi-agent-plan-toggle-copy,
.multi-agent-canvas-title-copy {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;

  h3 {
    margin: 0;
    font-size: 14px;
    line-height: 20px;
    color: var(--text-primary);
    font-weight: 600;
  }
}

.multi-agent-plan-toggle-icon {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: rgba(220, 252, 231, 0.96);
  border: 1px solid rgba(34, 197, 94, 0.28);
  color: #16a34a;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 20px;

  svg {
    width: 12px;
    height: 12px;
  }
}

.multi-agent-chevron {
  color: var(--text-tertiary);
  flex-shrink: 0;
  transition: transform $transition-fast;

  &.rotated {
    transform: rotate(180deg);
  }
}

.multi-agent-plan-body {
  position: relative;
  padding: 0 16px 16px 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.multi-agent-plan-line {
  position: absolute;
  top: 18px;
  bottom: 20px;
  left: 31px;
  width: 1px;
  background: rgba(34, 197, 94, 0.16);
}

.multi-agent-plan-step {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  gap: 12px;

  &.is-running {
    color: #2563eb;
  }

  &.is-done {
    color: #16a34a;
  }

  &.is-error {
    color: #dc2626;
  }
}

.multi-agent-plan-step-icon {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid rgba(148, 163, 184, 0.24);
  color: rgba(100, 116, 139, 0.9);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 22px;

  svg {
    width: 13px;
    height: 13px;
  }
}

.multi-agent-plan-step.is-done .multi-agent-plan-step-icon {
  background: rgba(220, 252, 231, 0.96);
  border-color: rgba(34, 197, 94, 0.28);
  color: #16a34a;
}

.multi-agent-plan-step.is-running .multi-agent-plan-step-icon {
  border-color: rgba(59, 130, 246, 0.32);
  color: #2563eb;
  box-shadow: 0 0 0 6px rgba(59, 130, 246, 0.08);
}

.multi-agent-plan-step.is-error .multi-agent-plan-step-icon {
  background: rgba(254, 242, 242, 0.96);
  border-color: rgba(248, 113, 113, 0.3);
  color: #dc2626;
}

.multi-agent-plan-step-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.56);
}

.multi-agent-plan-step-copy {
  min-width: 0;
  padding-top: 1px;

  strong {
    display: block;
    font-size: 13px;
    line-height: 18px;
    color: var(--text-primary);
  }

  p {
    margin: 4px 0 0;
    font-size: 12px;
    line-height: 18px;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }
}

.multi-agent-subhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  h3 {
    margin: 0;
    font-size: 14px;
    line-height: 20px;
    color: var(--text-primary);
    font-weight: 600;
  }

  span {
    height: 26px;
    padding: 0 10px;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.12);
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 26px;
    font-weight: 600;
    white-space: nowrap;
  }
}

.multi-agent-subhead.compact {
  h3 {
    font-size: 13px;
    line-height: 18px;
  }

  span {
    max-width: 56%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.multi-agent-reasoning-box {
  max-height: 120px;
  overflow-y: auto;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: #fff;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 19px;
  white-space: pre-wrap;
  word-break: break-word;
  scrollbar-width: thin;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.04);
}

.multi-agent-todo-list {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.multi-agent-todo-line {
  position: absolute;
  top: 18px;
  bottom: 18px;
  left: 14px;
  width: 2px;
  background: rgba(148, 163, 184, 0.22);
}

.multi-agent-todo-item {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 14px 14px 0;
  border-radius: 16px;
  transition: background-color $transition-fast, border-color $transition-fast;

  &.is-running {
    margin-inline: -8px;
    padding-inline: 8px 14px;
    background: rgba(239, 246, 255, 0.72);
    border: 1px solid rgba(147, 197, 253, 0.42);
  }

  &.is-done strong {
    text-decoration: line-through;
    text-decoration-color: rgba(148, 163, 184, 0.72);
  }
}

.multi-agent-todo-index {
  position: relative;
  z-index: 1;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: #fff;
  border: 2px solid rgba(203, 213, 225, 0.92);
  color: rgba(100, 116, 139, 0.9);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 28px;
  font-size: 12px;
  line-height: 1;
  font-weight: 600;
  box-shadow: 0 4px 10px rgba(15, 23, 42, 0.06);

  svg {
    width: 14px;
    height: 14px;
  }
}

.multi-agent-todo-item.is-done .multi-agent-todo-index {
  border-color: rgba(34, 197, 94, 0.42);
  color: #16a34a;
  background: rgba(240, 253, 244, 0.96);
}

.multi-agent-todo-item.is-running .multi-agent-todo-index {
  border-color: rgba(59, 130, 246, 0.56);
  color: #2563eb;
}

.multi-agent-todo-item.is-error .multi-agent-todo-index {
  border-color: rgba(248, 113, 113, 0.5);
  color: #dc2626;
  background: rgba(254, 242, 242, 0.96);
}

.multi-agent-spinner {
  width: 13px;
  height: 13px;
  border-radius: 999px;
  border: 2px solid rgba(37, 99, 235, 0.2);
  border-top-color: #2563eb;
  animation: multi-agent-spin 0.9s linear infinite;
}

.multi-agent-error-mark {
  font-size: 12px;
  font-weight: 700;
}

.multi-agent-todo-copy {
  min-width: 0;
  flex: 1;

  p {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 18px;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }
}

.multi-agent-todo-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;

  small {
    flex-shrink: 0;
    font-size: 12px;
    line-height: 18px;
    color: currentColor;
  }
}

.multi-agent-todo-title {
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;

  strong {
    font-size: 13px;
    line-height: 18px;
    color: var(--text-primary);
    font-weight: 700;
  }
}

.multi-agent-agent-chip {
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: #f8fafc;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  white-space: nowrap;

  &.is-subagent {
    border-color: rgba(59, 130, 246, 0.2);
    background: rgba(219, 234, 254, 0.96);
    color: #2563eb;
  }
}

.multi-agent-canvas-title-copy {
  svg {
    width: 15px;
    height: 15px;
    color: var(--text-tertiary);
  }
}

.multi-agent-canvas {
  position: relative;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: #fff;
  overflow: hidden;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
}

.multi-agent-canvas-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.multi-agent-canvas-edge {
  fill: none;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.92;

  &.is-blue {
    stroke: #93c5fd;
  }

  &.is-green {
    stroke: #22c55e;
  }

  &.is-gray {
    stroke: #cbd5e1;
  }

  &.is-red {
    stroke: #fca5a5;
  }

  &.is-animated {
    stroke-dasharray: 6 4;
    animation: edge-pulse 1.2s linear infinite;
  }
}

.multi-agent-canvas-node {
  position: absolute;
  z-index: 1;
  min-height: 84px;
  padding: 12px 12px 10px;
  border-radius: 14px;
  border: 2px solid rgba(203, 213, 225, 0.84);
  background: #fff;
  text-align: center;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  transition: border-color $transition-fast, box-shadow $transition-fast, background-color $transition-fast;

  strong {
    display: block;
    font-size: 11px;
    line-height: 16px;
    color: var(--text-primary);
    font-weight: 600;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  small {
    display: block;
    font-size: 10px;
    line-height: 15px;
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.multi-agent-canvas-node.is-doing {
  border-color: #60a5fa;
  background: rgba(239, 246, 255, 0.96);
  box-shadow: 0 12px 28px rgba(59, 130, 246, 0.16);
  color: #2563eb;
}

.multi-agent-canvas-node.is-done {
  border-color: #22c55e;
  background: rgba(240, 253, 244, 0.96);
  color: #16a34a;
}

.multi-agent-canvas-node.is-blocked {
  border-color: #f87171;
  background: rgba(254, 242, 242, 0.96);
  color: #dc2626;
}

.multi-agent-canvas-node-badge {
  position: absolute;
  top: -10px;
  right: -8px;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #3b82f6;
  color: #fff;
  font-size: 10px;
  line-height: 1;
  font-weight: 700;
  border: 2px solid #fff;
}

.multi-agent-canvas-node.is-done .multi-agent-canvas-node-badge {
  background: #22c55e;
}

.multi-agent-canvas-node.is-blocked .multi-agent-canvas-node-badge {
  background: #ef4444;
}

.multi-agent-canvas-node-state {
  display: block;
  margin-top: 4px;
  font-size: 10px;
  line-height: 15px;
  font-weight: 600;
  color: currentColor;
}

@keyframes multi-agent-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@keyframes edge-pulse {
  from {
    stroke-dashoffset: 14;
  }

  to {
    stroke-dashoffset: 0;
  }
}

@media (max-width: 1200px) {
  .multi-agent-sidebar {
    width: 340px;
    min-width: 340px;
  }
}

@media (max-width: 960px) {
  .multi-agent-sidebar {
    width: 100%;
    min-width: 0;
    border-left: 0;
    border-top: 1px solid rgba(15, 23, 42, 0.08);
  }
}
</style>
