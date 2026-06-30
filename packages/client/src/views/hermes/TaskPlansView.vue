<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NButton, NInput, NPopconfirm, NSelect, NTag, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/hermes/app'
import {
  deleteTaskPlan,
  exportTaskPlanToKanban,
  generateTaskPlan,
  listTaskPlans,
  updateTaskPlan,
  type TaskPlanAgentCandidate,
  type TaskPlanAgentRoute,
  type TaskPlanDependency,
  type TaskPlanDocument,
  type TaskPlanRecord,
  type TaskPlanTask,
} from '@/api/hermes/task-plans'

const SUB_AGENT_STORAGE_KEY = 'hermes.subAgents.frontendDraft.v4'
const message = useMessage()
const appStore = useAppStore()

const plans = ref<TaskPlanRecord[]>([])
const selectedPlanId = ref('')
const draftPlan = ref<TaskPlanRecord | null>(null)
const requirement = ref('')
const search = ref('')
const loading = ref(false)
const generating = ref(false)
const saving = ref(false)
const exporting = ref(false)
const deleting = ref(false)
const subAgents = ref<TaskPlanAgentCandidate[]>([])

const emptyPlanDocument = (): TaskPlanDocument => ({
  tasks: [],
  dependencies: [],
  agent_routes: [],
  risks: [],
  acceptance_criteria: [],
})

const selectedPlan = computed(() => plans.value.find(plan => plan.id === selectedPlanId.value) || plans.value[0] || null)
const activePlan = computed(() => draftPlan.value || selectedPlan.value)

const filteredPlans = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return plans.value
  return plans.value.filter(plan => [
    plan.title,
    plan.summary,
    plan.requirement,
    plan.status,
    plan.planner_model,
  ].some(value => String(value || '').toLowerCase().includes(keyword)))
})

const modelLabel = computed(() => {
  if (!appStore.selectedProvider || !appStore.selectedModel) return '未选择模型'
  return `${appStore.selectedProvider} / ${appStore.selectedModel}`
})

const agentOptions = computed(() => [
  { label: '待分配', value: '' },
  ...subAgents.value.map(agent => ({ label: agent.name, value: agent.id })),
])

const phaseGroups = computed(() => {
  const plan = activePlan.value?.plan_json || emptyPlanDocument()
  const groups: Array<{ phase: string; tasks: TaskPlanTask[] }> = []
  const byPhase = new Map<string, TaskPlanTask[]>()
  for (const task of plan.tasks || []) {
    const phase = task.phase || '未分组'
    if (!byPhase.has(phase)) byPhase.set(phase, [])
    byPhase.get(phase)!.push(task)
  }
  for (const [phase, tasks] of byPhase) groups.push({ phase, tasks })
  return groups
})

const routesByTask = computed(() => {
  const map = new Map<string, TaskPlanAgentRoute>()
  for (const route of activePlan.value?.plan_json.agent_routes || []) {
    map.set(route.task_id, route)
  }
  return map
})

const incomingDependencies = computed(() => {
  const map = new Map<string, TaskPlanDependency[]>()
  for (const dep of activePlan.value?.plan_json.dependencies || []) {
    if (!map.has(dep.to)) map.set(dep.to, [])
    map.get(dep.to)!.push(dep)
  }
  return map
})

const hasDraftChanges = computed(() => {
  if (!draftPlan.value || !selectedPlan.value) return false
  return JSON.stringify(draftPlan.value) !== JSON.stringify(selectedPlan.value)
})

function normalizePlanDocument(value: unknown): TaskPlanDocument {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<TaskPlanDocument>
    : {}
  return {
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    dependencies: Array.isArray(raw.dependencies) ? raw.dependencies : [],
    agent_routes: Array.isArray(raw.agent_routes) ? raw.agent_routes : [],
    risks: Array.isArray(raw.risks) ? raw.risks : [],
    acceptance_criteria: Array.isArray(raw.acceptance_criteria) ? raw.acceptance_criteria : [],
  }
}

function clonePlan(plan: TaskPlanRecord | null): TaskPlanRecord | null {
  if (!plan) return null
  return JSON.parse(JSON.stringify({
    ...plan,
    plan_json: normalizePlanDocument(plan.plan_json),
  }))
}

function formatTime(value: number): string {
  return value ? new Date(value).toLocaleString() : '-'
}

function statusLabel(status: string): string {
  if (status === 'confirmed') return '已确认'
  if (status === 'exported') return '已导出'
  if (status === 'archived') return '已归档'
  return '草稿'
}

function statusType(status: string) {
  if (status === 'confirmed') return 'info'
  if (status === 'exported') return 'success'
  if (status === 'archived') return 'default'
  return 'warning'
}

function taskStatusType(status: string) {
  if (status === 'confirmed') return 'info'
  if (status === 'exported') return 'success'
  return 'warning'
}

function routeForTask(task: TaskPlanTask): TaskPlanAgentRoute | null {
  return routesByTask.value.get(task.id) || null
}

function agentLabel(task: TaskPlanTask): string {
  return routeForTask(task)?.agent_name || task.recommended_agent_name || '待分配'
}

function dependencyText(task: TaskPlanTask): string {
  const deps = incomingDependencies.value.get(task.id) || []
  if (deps.length === 0) return '无前置依赖'
  return deps.map(dep => `${dep.from} ${dep.type === 'informs' ? '提示' : '阻塞'} ${dep.to}`).join('，')
}

function readSubAgents(): TaskPlanAgentCandidate[] {
  try {
    const raw = localStorage.getItem(SUB_AGENT_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.map((agent: any) => ({
      id: String(agent.id || agent.name || ''),
      name: String(agent.name || agent.id || ''),
      description: String(agent.description || ''),
      baseUrl: String(agent.baseUrl || ''),
      skills: Array.isArray(agent.skills) ? agent.skills.map((item: any) => ({
        name: String(item.name || ''),
        description: String(item.description || ''),
      })) : [],
      tools: Array.isArray(agent.tools) ? agent.tools.map((item: any) => ({
        name: String(item.name || ''),
        description: String(item.description || ''),
      })) : [],
    })).filter(agent => agent.id && agent.name)
  } catch {
    return []
  }
}

async function refreshPlans(keepSelection = true) {
  loading.value = true
  try {
    const next = await listTaskPlans()
    plans.value = next.map(plan => ({ ...plan, plan_json: normalizePlanDocument(plan.plan_json) }))
    if (!keepSelection || !plans.value.some(plan => plan.id === selectedPlanId.value)) {
      selectedPlanId.value = plans.value[0]?.id || ''
    }
    draftPlan.value = clonePlan(selectedPlan.value)
  } catch (err: any) {
    message.error(err?.message || '读取任务规划失败')
  } finally {
    loading.value = false
  }
}

async function generatePlan() {
  const text = requirement.value.trim()
  if (!text) {
    message.error('请输入需求')
    return
  }
  if (!appStore.selectedModel || !appStore.selectedProvider) {
    message.error('请先选择 Hermes 模型')
    return
  }
  generating.value = true
  try {
    const plan = await generateTaskPlan({
      requirement: text,
      provider: appStore.selectedProvider,
      model: appStore.selectedModel,
      agents: subAgents.value,
    })
    plans.value = [{ ...plan, plan_json: normalizePlanDocument(plan.plan_json) }, ...plans.value]
    selectedPlanId.value = plan.id
    draftPlan.value = clonePlan(plans.value[0])
    requirement.value = ''
    message.success('任务规划已生成')
  } catch (err: any) {
    message.error(err?.message || '生成任务规划失败')
  } finally {
    generating.value = false
  }
}

function selectPlan(id: string) {
  selectedPlanId.value = id
}

function mutateDraft(mutator: (plan: TaskPlanRecord) => void) {
  if (!draftPlan.value) return
  mutator(draftPlan.value)
}

function updateTask(taskId: string, patch: Partial<TaskPlanTask>) {
  mutateDraft((plan) => {
    plan.plan_json.tasks = plan.plan_json.tasks.map(task => (
      task.id === taskId ? { ...task, ...patch } : task
    ))
  })
}

function updateTaskAcceptance(taskId: string, value: string) {
  updateTask(taskId, {
    acceptance_criteria: value.split('\n').map(item => item.trim()).filter(Boolean),
  })
}

function updateTaskAgent(task: TaskPlanTask, agentId: string | null) {
  const agent = subAgents.value.find(item => item.id === agentId)
  mutateDraft((plan) => {
    plan.plan_json.tasks = plan.plan_json.tasks.map(item => (
      item.id === task.id
        ? {
            ...item,
            recommended_agent_id: agent?.id || null,
            recommended_agent_name: agent?.name || null,
          }
        : item
    ))
    const route: TaskPlanAgentRoute = {
      task_id: task.id,
      agent_id: agent?.id || null,
      agent_name: agent?.name || null,
      reason: agent ? '人工选择的子智能体' : '待分配',
      confidence: agent ? 1 : 0,
    }
    const exists = plan.plan_json.agent_routes.some(item => item.task_id === task.id)
    plan.plan_json.agent_routes = exists
      ? plan.plan_json.agent_routes.map(item => item.task_id === task.id ? route : item)
      : [...plan.plan_json.agent_routes, route]
  })
}

async function savePlan(status?: TaskPlanRecord['status']) {
  const plan = draftPlan.value
  if (!plan) return
  saving.value = true
  try {
    const nextPlan = status
      ? {
          ...plan,
          status,
          plan_json: {
            ...plan.plan_json,
            tasks: plan.plan_json.tasks.map(task => ({
              ...task,
              status: status === 'confirmed' ? 'confirmed' as const : task.status,
            })),
          },
        }
      : plan
    const saved = await updateTaskPlan(plan.id, {
      title: nextPlan.title,
      requirement: nextPlan.requirement,
      summary: nextPlan.summary,
      status: nextPlan.status,
      plan: nextPlan.plan_json,
    })
    const normalized = { ...saved, plan_json: normalizePlanDocument(saved.plan_json) }
    plans.value = plans.value.map(item => item.id === normalized.id ? normalized : item)
    draftPlan.value = clonePlan(normalized)
    message.success(status === 'confirmed' ? '计划已确认' : '计划已保存')
  } catch (err: any) {
    message.error(err?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function exportKanban() {
  const plan = draftPlan.value
  if (!plan) return
  if (hasDraftChanges.value) {
    await savePlan()
  }
  exporting.value = true
  try {
    const res = await exportTaskPlanToKanban(plan.id, { board: 'default' })
    const normalized = { ...res.plan, plan_json: normalizePlanDocument(res.plan.plan_json) }
    plans.value = plans.value.map(item => item.id === normalized.id ? normalized : item)
    draftPlan.value = clonePlan(normalized)
    message.success(`已导出 ${res.exported.length} 个 Kanban 任务`)
  } catch (err: any) {
    message.error(err?.message || '导出 Kanban 失败')
  } finally {
    exporting.value = false
  }
}

async function removePlan() {
  const plan = selectedPlan.value
  if (!plan) return
  deleting.value = true
  try {
    await deleteTaskPlan(plan.id)
    plans.value = plans.value.filter(item => item.id !== plan.id)
    selectedPlanId.value = plans.value[0]?.id || ''
    draftPlan.value = clonePlan(selectedPlan.value)
    message.success('任务规划已删除')
  } catch (err: any) {
    message.error(err?.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

watch(selectedPlanId, () => {
  draftPlan.value = clonePlan(selectedPlan.value)
})

onMounted(async () => {
  subAgents.value = readSubAgents()
  await appStore.loadModels(false, { preserveSelection: true })
  await refreshPlans(false)
})
</script>

<template>
  <div class="task-plans-view">
    <header class="page-header">
      <div class="header-text">
        <h2 class="header-title">任务规划</h2>
        <p class="header-subtitle">输入通用需求，生成可编辑任务清单和子智能体执行路径。</p>
      </div>
      <div class="header-actions">
        <NTag size="small" type="info">{{ modelLabel }}</NTag>
        <NButton size="small" :loading="loading" @click="refreshPlans()">刷新</NButton>
      </div>
    </header>

    <main class="task-plan-shell">
      <aside class="plan-list-pane">
        <div class="compose-panel">
          <div class="panel-title">新需求</div>
          <NInput
            v-model:value="requirement"
            type="textarea"
            :autosize="{ minRows: 5, maxRows: 9 }"
            placeholder="描述你要完成的事情，例如：整理一份跨部门上线方案、分析一批客户反馈、规划一个自动化流程..."
          />
          <div class="compose-footer">
            <span>{{ subAgents.length }} 个子智能体候选</span>
            <NButton type="primary" size="small" :loading="generating" @click="generatePlan">生成任务清单</NButton>
          </div>
        </div>

        <NInput v-model:value="search" size="small" clearable placeholder="搜索计划" />
        <div class="plan-list">
          <button
            v-for="plan in filteredPlans"
            :key="plan.id"
            class="plan-row"
            :class="{ active: activePlan?.id === plan.id }"
            type="button"
            @click="selectPlan(plan.id)"
          >
            <span class="plan-row-main">
              <strong>{{ plan.title }}</strong>
              <span>{{ plan.summary || plan.requirement }}</span>
            </span>
            <NTag size="small" :type="statusType(plan.status)">{{ statusLabel(plan.status) }}</NTag>
          </button>
          <div v-if="filteredPlans.length === 0" class="empty-list">暂无任务规划</div>
        </div>
      </aside>

      <section v-if="activePlan" class="plan-detail-pane">
        <div class="detail-header">
          <div class="detail-title-block">
            <NInput
              :value="activePlan.title"
              class="title-input"
              @update:value="value => mutateDraft(plan => { plan.title = value })"
            />
            <p>由 {{ activePlan.planner_provider || '-' }} / {{ activePlan.planner_model || '-' }} 生成，{{ formatTime(activePlan.updated_at) }}</p>
          </div>
          <div class="detail-actions">
            <NTag :type="statusType(activePlan.status)">{{ statusLabel(activePlan.status) }}</NTag>
            <NButton size="small" :disabled="!hasDraftChanges" :loading="saving" @click="savePlan()">保存</NButton>
            <NButton size="small" :loading="saving" @click="savePlan('confirmed')">确认计划</NButton>
            <NButton type="primary" size="small" :loading="exporting" @click="exportKanban">导出 Kanban</NButton>
            <NPopconfirm @positive-click="removePlan">
              <template #trigger>
                <NButton size="small" quaternary type="error" :loading="deleting">删除</NButton>
              </template>
              删除这个任务规划？
            </NPopconfirm>
          </div>
        </div>

        <div class="plan-content">
          <section class="plan-main">
            <div class="panel">
              <div class="panel-title">需求与摘要</div>
              <label>
                <span>原始需求</span>
                <NInput
                  :value="activePlan.requirement"
                  type="textarea"
                  :autosize="{ minRows: 3, maxRows: 5 }"
                  @update:value="value => mutateDraft(plan => { plan.requirement = value })"
                />
              </label>
              <label>
                <span>计划摘要</span>
                <NInput
                  :value="activePlan.summary"
                  type="textarea"
                  :autosize="{ minRows: 2, maxRows: 4 }"
                  @update:value="value => mutateDraft(plan => { plan.summary = value })"
                />
              </label>
            </div>

            <div class="panel task-panel">
              <div class="panel-title">任务清单</div>
              <div v-for="group in phaseGroups" :key="group.phase" class="phase-group">
                <div class="phase-title">{{ group.phase }}</div>
                <article v-for="task in group.tasks" :key="task.id" class="task-item">
                  <div class="task-item-header">
                    <div class="task-id">{{ task.id }}</div>
                    <NInput
                      :value="task.title"
                      class="task-title-input"
                      @update:value="value => updateTask(task.id, { title: value })"
                    />
                    <NTag size="small" :type="taskStatusType(task.status)">{{ task.status }}</NTag>
                  </div>
                  <NInput
                    :value="task.description"
                    type="textarea"
                    :autosize="{ minRows: 2, maxRows: 4 }"
                    @update:value="value => updateTask(task.id, { description: value })"
                  />
                  <div class="task-meta-grid">
                    <label>
                      <span>推荐子智能体</span>
                      <NSelect
                        :value="task.recommended_agent_id || ''"
                        :options="agentOptions"
                        size="small"
                        @update:value="value => updateTaskAgent(task, value)"
                      />
                    </label>
                    <label>
                      <span>验收标准</span>
                      <NInput
                        :value="task.acceptance_criteria.join('\n')"
                        type="textarea"
                        :autosize="{ minRows: 2, maxRows: 4 }"
                        @update:value="value => updateTaskAcceptance(task.id, value)"
                      />
                    </label>
                  </div>
                </article>
              </div>
              <div v-if="activePlan.plan_json.tasks.length === 0" class="empty-list">当前计划还没有任务</div>
            </div>
          </section>

          <aside class="plan-side">
            <section class="panel">
              <div class="panel-title">执行路径</div>
              <div class="path-list">
                <div v-for="task in activePlan.plan_json.tasks" :key="task.id" class="path-node">
                  <div class="path-node-id">{{ task.id }}</div>
                  <div>
                    <strong>{{ task.title }}</strong>
                    <span>{{ dependencyText(task) }}</span>
                    <em>{{ agentLabel(task) }}</em>
                  </div>
                </div>
              </div>
            </section>

            <section class="panel">
              <div class="panel-title">Agent 路由</div>
              <div v-for="route in activePlan.plan_json.agent_routes" :key="route.task_id" class="route-row">
                <strong>{{ route.task_id }} · {{ route.agent_name || '待分配' }}</strong>
                <span>{{ route.reason }}</span>
                <NTag size="small" type="info">confidence {{ Math.round(route.confidence * 100) }}%</NTag>
              </div>
              <div v-if="activePlan.plan_json.agent_routes.length === 0" class="empty-list">暂无路由建议</div>
            </section>

            <section class="panel">
              <div class="panel-title">风险与总体验收</div>
              <div class="side-list">
                <strong>风险</strong>
                <span v-for="risk in activePlan.plan_json.risks" :key="risk">{{ risk }}</span>
                <span v-if="activePlan.plan_json.risks.length === 0">暂无风险</span>
              </div>
              <div class="side-list">
                <strong>验收</strong>
                <span v-for="item in activePlan.plan_json.acceptance_criteria" :key="item">{{ item }}</span>
                <span v-if="activePlan.plan_json.acceptance_criteria.length === 0">暂无总体验收标准</span>
              </div>
            </section>
          </aside>
        </div>
      </section>

      <section v-else class="plan-detail-pane empty-state">
        <strong>还没有任务规划</strong>
        <span>输入一个需求后生成任务清单，或等待已有计划加载完成。</span>
      </section>
    </main>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.task-plans-view {
  height: calc(100 * var(--vh));
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.page-header {
  flex: 0 0 auto;
}

.header-subtitle {
  margin: 4px 0 0;
  color: $text-secondary;
  font-size: 13px;
  line-height: 1.5;
}

.header-actions,
.detail-actions,
.compose-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.task-plan-shell {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
  gap: 16px;
  padding: 16px 20px 20px;
  overflow: hidden;
}

.plan-list-pane,
.plan-detail-pane,
.panel,
.compose-panel {
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
}

.plan-list-pane {
  min-height: 0;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.compose-panel,
.panel {
  padding: 14px;
}

.panel-title {
  font-size: 14px;
  font-weight: 700;
  color: $text-primary;
  margin-bottom: 10px;
}

.compose-footer {
  justify-content: space-between;
  margin-top: 10px;

  span {
    color: $text-secondary;
    font-size: 12px;
  }
}

.plan-list {
  min-height: 0;
  overflow-y: auto;
  display: grid;
  gap: 6px;
}

.plan-row {
  width: 100%;
  min-height: 72px;
  border: 1px solid transparent;
  border-radius: $radius-sm;
  background: transparent;
  color: $text-primary;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  cursor: pointer;
  text-align: left;

  &:hover,
  &.active {
    border-color: rgba(var(--accent-primary-rgb), 0.22);
    background: rgba(var(--accent-primary-rgb), 0.06);
  }
}

.plan-row-main {
  min-width: 0;
  display: grid;
  gap: 4px;

  strong,
  span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  span {
    color: $text-secondary;
    font-size: 12px;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
}

.empty-list,
.empty-state {
  color: $text-muted;
  font-size: 13px;
  text-align: center;
}

.empty-list {
  padding: 16px;
}

.plan-detail-pane {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}

.empty-state {
  display: grid;
  place-content: center;
  gap: 6px;

  strong {
    color: $text-primary;
    font-size: 16px;
  }
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.detail-title-block {
  min-width: 0;
  flex: 1;

  p {
    margin: 6px 0 0;
    color: $text-secondary;
    font-size: 12px;
  }
}

.title-input :deep(input) {
  height: 38px;
  font-size: 22px;
  font-weight: 700;
}

.plan-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
  gap: 14px;
  align-items: start;
}

.plan-main,
.plan-side {
  min-width: 0;
  display: grid;
  gap: 12px;
}

label {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;

  span {
    color: $text-secondary;
    font-size: 12px;
    font-weight: 650;
  }
}

.phase-group {
  display: grid;
  gap: 8px;
  margin-bottom: 16px;
}

.phase-title {
  color: $text-secondary;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.task-item {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid $border-light;
  border-radius: $radius-sm;
  background: $bg-primary;
}

.task-item-header {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.task-id,
.path-node-id {
  min-width: 36px;
  min-height: 28px;
  border-radius: 999px;
  background: rgba(var(--accent-primary-rgb), 0.1);
  color: $accent-primary;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
}

.task-title-input :deep(input) {
  font-weight: 650;
}

.task-meta-grid {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
  gap: 10px;
}

.path-list {
  display: grid;
  gap: 8px;
}

.path-node,
.route-row {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  padding: 10px;
  border: 1px solid $border-light;
  border-radius: $radius-sm;
  background: $bg-primary;

  strong,
  span,
  em {
    display: block;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  span {
    margin-top: 3px;
    color: $text-secondary;
    font-size: 12px;
    line-height: 1.45;
  }

  em {
    margin-top: 5px;
    color: $accent-primary;
    font-size: 12px;
    font-style: normal;
    font-weight: 650;
  }
}

.route-row {
  grid-template-columns: minmax(0, 1fr);
  margin-bottom: 8px;
}

.side-list {
  display: grid;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid $border-light;

  &:first-of-type {
    padding-top: 0;
    border-top: 0;
  }

  & + .side-list {
    margin-top: 12px;
  }

  strong {
    color: $text-primary;
    font-size: 13px;
  }

  span {
    color: $text-secondary;
    font-size: 12px;
    line-height: 1.45;
  }
}

@media (max-width: 1200px) {
  .task-plan-shell,
  .plan-content {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .plan-list-pane,
  .plan-detail-pane {
    overflow: visible;
  }
}

@media (max-width: 760px) {
  .task-plan-shell {
    padding: 12px;
  }

  .detail-header,
  .detail-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .task-meta-grid {
    grid-template-columns: 1fr;
  }

  .task-item-header {
    grid-template-columns: auto minmax(0, 1fr);

    > :last-child {
      grid-column: 1 / -1;
      justify-self: start;
    }
  }
}
</style>
