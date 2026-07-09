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
  status: "todo" | "doing" | "done" | "partial" | "blocked" | "unsafe" | "failed" | "waiting_replan" | "invalidated" | "skipped"
  outcome: "unknown" | "success" | "partial" | "failure" | "unsafe"
}

type TodoEntry = {
  id: string
  index: number
  title: string
  detail: string
  dependsOn: string[]
  agentName: string
  executorType: "hermes" | "subagent"
  status: "pending" | "running" | "done" | "warning" | "error"
  outcome: "unknown" | "success" | "partial" | "failure" | "unsafe"
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
  tone: "blue" | "green" | "gray" | "amber" | "red"
  animated: boolean
}

type HistoryRunEntry = {
  runId: string
  objective: string
  status: "idle" | "running" | "completed" | "failed"
  startedAt: number
  endedAt: number | null
}

const CANVAS_MIN_HEIGHT = 288
const CANVAS_NODE_HEIGHT = 92
const CANVAS_TOP_PADDING = 24
const CANVAS_BOTTOM_PADDING = 28
const CANVAS_LEVEL_GAP = 116

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
  const workflowReasoning = (props.workflowSnapshot?.mainAgentStream || props.workflowSnapshot?.reasoningText || "").trim()
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
  return text.replace(/\n{3,}/g, "\n\n")
})

const effectiveCurrentTaskId = computed(() => {
  const routeCurrentNodeId = String(props.route?.currentNodeId || "").trim()
  if (routeCurrentNodeId && props.tasks.some(task => task.id === routeCurrentNodeId)) {
    return routeCurrentNodeId
  }
  const runningTask = props.tasks.find(task => task.status === "doing")
  return runningTask?.id || ""
})

const effectiveTodoEntries = computed<TodoEntry[]>(() => {
  if (props.tasks.length > 0) {
    return props.tasks.map((task) => {
      const isCurrentPendingTask = task.id === effectiveCurrentTaskId.value && task.status === "todo"
      return {
        id: task.id,
        index: task.index,
        title: task.title,
        detail: task.summary || "等待执行。",
        dependsOn: task.dependsOn || [],
        agentName: task.agentName || "",
        executorType: task.executorType,
        outcome: task.outcome,
        status: task.status === "done"
          ? "done"
          : task.status === "doing" || isCurrentPendingTask
            ? "running"
            : task.status === "partial"
              || task.status === "unsafe"
              || task.status === "waiting_replan"
              || task.status === "invalidated"
              || task.status === "skipped"
              ? "warning"
              : task.status === "blocked" || task.status === "failed"
                ? "error"
                : "pending",
      }
    })
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
      outcome: step.status === "error" ? "failure" : step.status === "done" ? "success" : "unknown",
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
const currentHistoryIndex = computed(() => {
  const runs = historyRuns.value
  if (!runs.length) return -1
  const selectedRunId = props.selectedRunId || runs[0]?.runId || ""
  const matchedIndex = runs.findIndex(item => item.runId === selectedRunId)
  return matchedIndex >= 0 ? matchedIndex : 0
})

const currentHistoryEntry = computed(() => {
  if (currentHistoryIndex.value < 0) return null
  return historyRuns.value[currentHistoryIndex.value] || null
})

const canSelectPrevHistory = computed(() => currentHistoryIndex.value > 0)
const canSelectNextHistory = computed(() =>
  currentHistoryIndex.value >= 0 && currentHistoryIndex.value < historyRuns.value.length - 1,
)

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
    case "warning":
      return "等待重规划"
    case "error":
      return "失败"
    default:
      return "等待执行"
  }
}

function outcomeBadgeLabel(outcome: TodoEntry["outcome"], status: TodoEntry["status"] | ExecutionTask["status"]) {
  if (status === "warning" || status === "waiting_replan" || status === "invalidated" || status === "skipped") {
    return outcome === "unsafe" ? "不可汇总" : "已暂停"
  }
  if (status === "error" || status === "failed" || status === "blocked") return "失败"
  if (outcome === "success") return "成功"
  if (outcome === "partial") return "部分完成"
  if (outcome === "unsafe") return "不可汇总"
  if (outcome === "failure") return "失败"
  if (status === "running" || status === "doing") return "运行中"
  return "待定"
}

function normalizePrimaryActorLabel(value?: string) {
  const text = String(value || "").trim()
  if (!text) return "主智能体"
  if (/^hermes$/i.test(text)) return "主智能体"
  return text
}

function todoAgentLabel(entry: TodoEntry) {
  if (entry.executorType === "hermes") return "主智能体"
  if (entry.executorType === "subagent" && entry.agentName) return normalizePrimaryActorLabel(entry.agentName)
  if (entry.agentName) return normalizePrimaryActorLabel(entry.agentName)
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
  if (props.tasks.length > 0) {
    return props.tasks.map((task) => {
      if (task.id !== effectiveCurrentTaskId.value || task.status !== "todo") return task
      return {
        ...task,
        status: "doing",
        outcome: "unknown",
      }
    })
  }
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
      outcome: entry.outcome,
      status: entry.status === "done"
        ? "done"
        : entry.status === "running"
          ? "doing"
          : entry.status === "warning"
            ? (entry.outcome === "unsafe"
                ? "unsafe"
                : entry.outcome === "partial"
                  ? "partial"
                  : "waiting_replan")
            : entry.status === "error"
              ? "failed"
              : "todo",
  }))
})

const planCardSteps = computed<PlanCardStep[]>(() => {
  const intentStatus = resolveFixedPlanStatus("understand")
  const decomposeStatus = resolveFixedPlanStatus("route")
  const todoStatus: PlanCardStep["status"] = hasGeneratedTodo.value
    ? (decomposeStatus === "done" ? "done" : "running")
    : (decomposeStatus === "done" ? "running" : "pending")
  const canvasStatus: PlanCardStep["status"] = effectiveRouteState.value === "failed"
    ? "error"
    : effectiveCanvasTasks.value.length > 0
      ? (todoStatus === "done" ? "done" : "running")
      : (todoStatus === "done" ? "running" : "pending")

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
    const width = row.length >= 3 ? 120 : 148
    return row.map((task, columnIndex) => {
      const left = row.length === 1
        ? 50
        : row.length === 2
          ? [29, 71][columnIndex] || 50
          : 15 + (70 / Math.max(1, row.length - 1)) * columnIndex
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
  if (status === "blocked" || status === "failed") return "red"
  if (status === "unsafe" || status === "partial" || status === "waiting_replan" || status === "invalidated" || status === "skipped") return "amber"
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
      const sameColumn = Math.abs(startX - endX) < 1.5
      const midY = Math.round(startY + Math.max(18, (endY - startY) * 0.48))
      const path = sameColumn
        ? `M ${startX} ${startY} L ${endX} ${endY}`
        : `M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}`

      return {
        id: `edge:${pair.from}:${pair.to}`,
        path,
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
    case "partial":
      return "部分完成"
    case "unsafe":
      return "不可汇总"
    case "waiting_replan":
      return "等待重规划"
    case "invalidated":
      return "已失效"
    case "skipped":
      return "已跳过"
    case "failed":
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

function selectHistoryOffset(offset: number) {
  if (currentHistoryIndex.value < 0) return
  const nextIndex = Math.min(
    historyRuns.value.length - 1,
    Math.max(0, currentHistoryIndex.value + offset),
  )
  const targetRunId = historyRuns.value[nextIndex]?.runId
  if (targetRunId) emit("selectRun", targetRunId)
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
          <div class="multi-agent-history-pager" data-testid="multi-agent-history-pager">
            <div class="multi-agent-history-pager-copy">
              <div class="multi-agent-history-pager-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 8v5l3 2" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
                <h3>协作历史</h3>
              </div>
              <div v-if="currentHistoryEntry" class="multi-agent-history-pager-meta">
                <strong>{{ currentHistoryEntry.objective }}</strong>
                <span>{{ formatHistoryTime(currentHistoryEntry.startedAt) }}</span>
                <small :class="historyStatusClass(currentHistoryEntry.status)">
                  {{ historyStatusLabel(currentHistoryEntry.status) }}
                </small>
              </div>
            </div>

            <div class="multi-agent-history-pager-controls">
              <button
                class="multi-agent-history-nav"
                type="button"
                :disabled="!canSelectPrevHistory"
                @click="selectHistoryOffset(-1)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span>{{ currentHistoryIndex + 1 }} / {{ historyRuns.length }}</span>
              <button
                class="multi-agent-history-nav"
                type="button"
                :disabled="!canSelectNextHistory"
                @click="selectHistoryOffset(1)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
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
                  <div class="multi-agent-plan-step-detail-box">
                    <p>{{ step.detail }}</p>
                  </div>
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
              :class="[`is-${entry.status}`, `outcome-${entry.outcome}`]"
              :data-outcome="entry.outcome"
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
                <span v-else-if="entry.status === 'warning'" class="multi-agent-warning-mark">~</span>
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
                    <span class="multi-agent-outcome-chip" :class="[`is-${entry.outcome}`, { 'is-warning': entry.status === 'warning' }]">
                      {{ outcomeBadgeLabel(entry.outcome, entry.status) }}
                    </span>
                  </div>
                  <small>{{ plannerStatusLabel(entry.status) }}</small>
                </div>
                <div class="multi-agent-todo-detail-box">
                  <p>{{ entry.detail }}</p>
                </div>
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
                <marker id="edge-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
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
              :class="[`is-${node.task.status}`, `outcome-${node.task.outcome}`]"
              :data-outcome="node.task.outcome"
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
                outcome: node.task.outcome,
                status: node.task.status === 'done'
                  ? 'done'
                  : node.task.status === 'doing'
                    ? 'running'
                    : node.task.status === 'failed' || node.task.status === 'blocked'
                      ? 'error'
                      : node.task.status === 'partial'
                        || node.task.status === 'unsafe'
                        || node.task.status === 'waiting_replan'
                        || node.task.status === 'invalidated'
                        || node.task.status === 'skipped'
                        ? 'warning'
                        : 'pending',
              }) }}</small>
              <span class="multi-agent-canvas-node-outcome" :class="[`is-${node.task.outcome}`, { 'is-warning': node.task.status === 'waiting_replan' || node.task.status === 'invalidated' || node.task.status === 'skipped' }]">
                {{ outcomeBadgeLabel(node.task.outcome, node.task.status) }}
              </span>
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

.multi-agent-history-pager {
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: #fff;
  border-radius: 14px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.multi-agent-history-pager-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.multi-agent-history-pager-title {
  display: flex;
  align-items: center;
  gap: 8px;

  svg {
    width: 15px;
    height: 15px;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  h3 {
    margin: 0;
    font-size: 14px;
    line-height: 20px;
    color: var(--text-primary);
    font-weight: 600;
  }
}

.multi-agent-history-pager-meta {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;

  strong {
    max-width: 100%;
    font-size: 12px;
    line-height: 18px;
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

.multi-agent-history-pager-controls {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;

  span {
    min-width: 46px;
    text-align: center;
    font-size: 12px;
    line-height: 18px;
    color: var(--text-secondary);
    font-weight: 600;
  }
}

.multi-agent-history-nav {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #fff;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color $transition-fast, border-color $transition-fast, color $transition-fast;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover:not(:disabled) {
    background: #f8fafc;
    border-color: rgba(59, 130, 246, 0.3);
    color: #2563eb;
  }

  &:disabled {
    opacity: 0.45;
    cursor: default;
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
  display: grid;
  grid-template-rows: auto 58px;
  gap: 6px;

  strong {
    display: block;
    font-size: 13px;
    line-height: 18px;
    color: var(--text-primary);
    min-height: 36px;
    max-height: 36px;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
}

.multi-agent-plan-step-detail-box {
  height: 58px;
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-width: thin;

  p {
    margin: 0;
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
  height: 120px;
  min-height: 120px;
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

  &.is-warning {
    margin-inline: -8px;
    padding-inline: 8px 14px;
    background: rgba(255, 251, 235, 0.88);
    border: 1px solid rgba(251, 191, 36, 0.36);
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

.multi-agent-todo-item.is-warning .multi-agent-todo-index {
  border-color: rgba(245, 158, 11, 0.42);
  color: #d97706;
  background: rgba(255, 251, 235, 0.98);
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

.multi-agent-warning-mark {
  font-size: 13px;
  font-weight: 700;
}

.multi-agent-todo-copy {
  min-width: 0;
  flex: 1;
  display: grid;
  grid-template-rows: auto 56px;
  gap: 6px;
}

.multi-agent-todo-detail-box {
  height: 56px;
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-width: thin;

  p {
    margin: 0;
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
    min-height: 36px;
    max-height: 36px;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
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

.multi-agent-outcome-chip {
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: #fff;
  color: var(--text-tertiary);
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  white-space: nowrap;

  &.is-success {
    border-color: rgba(34, 197, 94, 0.28);
    background: rgba(240, 253, 244, 0.96);
    color: #16a34a;
  }

  &.is-partial,
  &.is-unsafe {
    border-color: rgba(245, 158, 11, 0.28);
    background: rgba(255, 251, 235, 0.98);
    color: #d97706;
  }

  &.is-warning {
    border-color: rgba(245, 158, 11, 0.28);
    background: rgba(255, 251, 235, 0.98);
    color: #d97706;
  }

  &.is-failure {
    border-color: rgba(248, 113, 113, 0.28);
    background: rgba(254, 242, 242, 0.96);
    color: #dc2626;
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
  padding-inline: 6px;
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
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.92;

  &.is-blue {
    stroke: #93c5fd;
  }

  &.is-green {
    stroke: #22c55e;
  }

  &.is-amber {
    stroke: #f59e0b;
  }

  &.is-gray {
    stroke: #cbd5e1;
  }

  &.is-red {
    stroke: #fca5a5;
  }

  &.is-animated {
    stroke-dasharray: 7 5;
    animation: edge-pulse 1s linear infinite;
  }
}

.multi-agent-canvas-node {
  position: absolute;
  z-index: 1;
  height: 92px;
  padding: 12px 12px 10px;
  border-radius: 14px;
  border: 2px solid rgba(203, 213, 225, 0.84);
  background: #fff;
  text-align: center;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 4px;
  transition: border-color $transition-fast, box-shadow $transition-fast, background-color $transition-fast;

  strong {
    display: block;
    font-size: 11px;
    line-height: 16px;
    color: var(--text-primary);
    font-weight: 600;
    min-height: 32px;
    max-height: 32px;
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
    min-height: 15px;
    max-height: 15px;
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

.multi-agent-canvas-node.is-partial,
.multi-agent-canvas-node.is-unsafe,
.multi-agent-canvas-node.is-waiting_replan,
.multi-agent-canvas-node.is-invalidated,
.multi-agent-canvas-node.is-skipped {
  border-color: #f59e0b;
  background: rgba(255, 251, 235, 0.98);
  color: #d97706;
}

.multi-agent-canvas-node.is-blocked,
.multi-agent-canvas-node.is-failed {
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

.multi-agent-canvas-node.is-partial .multi-agent-canvas-node-badge,
.multi-agent-canvas-node.is-unsafe .multi-agent-canvas-node-badge,
.multi-agent-canvas-node.is-waiting_replan .multi-agent-canvas-node-badge,
.multi-agent-canvas-node.is-invalidated .multi-agent-canvas-node-badge,
.multi-agent-canvas-node.is-skipped .multi-agent-canvas-node-badge {
  background: #f59e0b;
}

.multi-agent-canvas-node.is-blocked .multi-agent-canvas-node-badge,
.multi-agent-canvas-node.is-failed .multi-agent-canvas-node-badge {
  background: #ef4444;
}

.multi-agent-canvas-node-state {
  display: block;
  margin-top: auto;
  font-size: 10px;
  line-height: 15px;
  font-weight: 600;
  color: currentColor;
}

.multi-agent-canvas-node-outcome {
  display: inline-flex;
  align-self: center;
  justify-content: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(255, 255, 255, 0.88);
  font-size: 10px;
  line-height: 18px;
  font-weight: 600;
  color: var(--text-tertiary);

  &.is-success {
    border-color: rgba(34, 197, 94, 0.28);
    color: #16a34a;
  }

  &.is-partial,
  &.is-unsafe {
    border-color: rgba(245, 158, 11, 0.28);
    color: #d97706;
  }

  &.is-warning {
    border-color: rgba(245, 158, 11, 0.28);
    color: #d97706;
  }

  &.is-failure {
    border-color: rgba(248, 113, 113, 0.28);
    color: #dc2626;
  }
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
