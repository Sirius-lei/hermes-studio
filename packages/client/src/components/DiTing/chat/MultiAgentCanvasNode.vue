<script setup lang="ts">
import { Handle, Position, type NodeProps } from "@vue-flow/core"
import { computed } from "vue"

export type MultiAgentCanvasNodeData = {
  index: number
  title: string
  phase: string
  summary: string
  status: "todo" | "doing" | "done" | "blocked" | "partial" | "unsafe" | "failed" | "waiting_replan" | "invalidated" | "skipped"
  agentName: string
  executorType: "DiTing" | "subagent"
}

const props = defineProps<NodeProps<MultiAgentCanvasNodeData>>()

const statusLabel = computed(() => {
  switch (props.data.status) {
    case "doing":
      return "执行中"
    case "done":
      return "已完成"
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
      return "待执行"
  }
})

const actorLabel = computed(() =>
  props.data.executorType === "subagent"
    ? props.data.agentName
    : "主智能体",
)
</script>

<template>
  <div class="canvas-node" :class="[`is-${data.status}`, { selected }]">
    <Handle id="top" type="target" :position="Position.Top" class="canvas-node-handle" />
    <Handle id="bottom" type="source" :position="Position.Bottom" class="canvas-node-handle" />

    <span class="canvas-node-index">{{ data.index }}</span>
    <div class="canvas-node-head">
      <strong>{{ data.title }}</strong>
      <small>{{ data.phase }}</small>
    </div>
    <div class="canvas-node-meta">
      <span class="canvas-node-chip">{{ actorLabel }}</span>
      <span class="canvas-node-state" :class="`is-${data.status}`">
        <span v-if="data.status === 'doing'" class="canvas-node-spinner"></span>
        <svg
          v-else-if="data.status === 'done'"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4 10.5 8 14.5 16 6.5" />
        </svg>
        <svg
          v-else-if="data.status === 'blocked' || data.status === 'failed'"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <path d="M6 6 14 14" />
          <path d="M14 6 6 14" />
        </svg>
        <span v-else-if="data.status === 'waiting_replan' || data.status === 'invalidated' || data.status === 'skipped'" class="canvas-node-pause"></span>
        <span v-else class="canvas-node-dot"></span>
        <span>{{ statusLabel }}</span>
      </span>
    </div>
    <div class="canvas-node-summary">
      <p>{{ data.summary || "等待节点开始执行。" }}</p>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.canvas-node {
  position: relative;
  width: 228px;
  min-height: 136px;
  padding: 14px 14px 12px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition:
    border-color $transition-fast,
    box-shadow $transition-fast,
    transform $transition-fast;

  &.selected,
  &.is-doing {
    border-color: rgba(37, 99, 235, 0.32);
    box-shadow: 0 20px 40px rgba(37, 99, 235, 0.12);
    transform: translateY(-1px);
  }

  &.is-done {
    border-color: rgba(22, 163, 74, 0.28);
  }

  &.is-blocked,
  &.is-failed {
    border-color: rgba(220, 38, 38, 0.28);
  }

  &.is-partial,
  &.is-unsafe,
  &.is-waiting_replan,
  &.is-invalidated,
  &.is-skipped {
    border-color: rgba(245, 158, 11, 0.28);
  }
}

.canvas-node-handle {
  width: 10px;
  height: 10px;
  opacity: 0;
  pointer-events: none;
}

.canvas-node-index {
  position: absolute;
  top: -10px;
  right: 12px;
  min-width: 24px;
  height: 24px;
  padding: 0 7px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-primary);
  color: #fff;
  font-size: 11px;
  line-height: 1;
  font-weight: 700;
  box-shadow: 0 10px 20px rgba(var(--accent-primary-rgb), 0.24);
}

.canvas-node-head {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;

  strong {
    font-size: 14px;
    line-height: 20px;
    color: var(--text-primary);
  }

  small {
    font-size: 12px;
    line-height: 16px;
    color: var(--text-tertiary);
  }
}

.canvas-node-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.canvas-node-chip {
  min-width: 0;
  max-width: 104px;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(var(--accent-primary-rgb), 0.08);
  color: var(--accent-primary);
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.canvas-node-state {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  color: var(--text-tertiary);

  svg {
    width: 12px;
    height: 12px;
  }

  &.is-doing {
    color: #2563eb;
  }

  &.is-done {
    color: #16a34a;
  }

  &.is-blocked,
  &.is-failed {
    color: #dc2626;
  }

  &.is-partial,
  &.is-unsafe,
  &.is-waiting_replan,
  &.is-invalidated,
  &.is-skipped {
    color: #d97706;
  }
}

.canvas-node-spinner {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 2px solid rgba(37, 99, 235, 0.18);
  border-top-color: #2563eb;
  animation: canvas-node-spin 0.9s linear infinite;
}

.canvas-node-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.7);
}

.canvas-node-pause {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 2px solid currentColor;
  opacity: 0.7;
}

.canvas-node-summary {
  min-height: 56px;
  max-height: 72px;
  overflow: auto;
  padding: 10px 11px;
  border-radius: 12px;
  background: rgba(248, 250, 252, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.18);
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

@keyframes canvas-node-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
