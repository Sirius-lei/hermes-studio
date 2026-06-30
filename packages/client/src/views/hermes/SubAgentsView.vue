<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  NButton,
  NInput,
  NModal,
  NTag,
  useMessage,
} from 'naive-ui'
import { copyToClipboard } from '@/utils/clipboard'

type AgentStatus = 'online' | 'offline' | 'draft' | 'configured'
type DeploymentStatus = 'validated' | 'deployed' | 'failed'
type AssetSource = 'runtime' | 'draft'

interface AssetRef {
  id: string
  name: string
  url: string
  description: string
  source: AssetSource
  path?: string
  version?: string
}

interface DeploymentRecord {
  id: string
  status: DeploymentStatus
  message: string
  createdAt: number
}

interface EndpointRef {
  method: 'GET' | 'POST'
  path: string
  label: string
  description: string
}

interface RuntimeConfig {
  source: string
  configPath: string
  configSection: string
  enabled: boolean
  chatPath: string
  timeoutSeconds: number
  apiKeyConfigured: boolean
  templateProject: string
  managementEndpoints: EndpointRef[]
  lastSyncedAt: number | null
  syncError: string
}

interface SubAgentRecord {
  id: string
  name: string
  description: string
  baseUrl: string
  status: AgentStatus
  agentsMd: string
  skills: AssetRef[]
  tools: AssetRef[]
  packages: string[]
  callCount: number
  successRate: number
  avgLatencyMs: number
  modelSummary: string
  lastRun: string
  lastPublishedAt: number | null
  deployments: DeploymentRecord[]
  runtimeConfig: RuntimeConfig
  updatedAt: number
}

interface RuntimeAsset {
  name?: string
  description?: string
  version?: string
  path?: string
  entry?: string
  url?: string
  size?: number
  modified?: number | string
  tags?: string[]
}

interface RuntimeAgentsMd {
  path?: string
  exists?: boolean
  content?: string
  size?: number
  modified?: number | string
}

interface RuntimeAgentProfile {
  id?: string
  name?: string
  description?: string
  agent_dir?: string
  workspace?: string
  agents_md?: RuntimeAgentsMd
  model_summary?: string
  packages?: string[]
  skills?: RuntimeAsset[]
  extensions?: RuntimeAsset[]
}

interface RuntimeConfigSummary {
  agents_md?: RuntimeAgentsMd
  packages?: string[]
  skills?: RuntimeAsset[]
  extensions?: RuntimeAsset[]
}

const STORAGE_KEY = 'hermes.subAgents.frontendDraft.v4'
const LEGACY_STORAGE_KEYS = [
  'hermes.subAgents.frontendDraft.v1',
  'hermes.subAgents.frontendDraft.v2',
  'hermes.subAgents.frontendDraft.v3',
]

const piMonoManagementEndpoints: EndpointRef[] = [
  { method: 'GET', path: '/health', label: 'Health', description: '检查 subAgent-pi 运行时是否可访问' },
  { method: 'GET', path: '/api/agent/profile', label: 'Profile', description: '读取子智能体身份、描述、AGENTS.md、模型摘要、skills 和 extensions' },
  { method: 'GET', path: '/api/agent/models', label: 'Models', description: '读取 models.json 脱敏后的模型配置和 model_summary' },
  { method: 'GET', path: '/api/agent/agents-md', label: 'AGENTS.md', description: '读取远程 AGENTS.md 内容和元信息' },
  { method: 'GET', path: '/api/agent/skills', label: 'Skills', description: '读取运行时已安装 skills' },
  { method: 'GET', path: '/api/agent/extensions', label: 'Extensions', description: '读取运行时已安装 extensions 和 packages' },
  { method: 'GET', path: '/api/agent/config', label: 'Config', description: '读取可注入配置摘要' },
  { method: 'POST', path: '/api/agent/config/validate', label: 'Validate', description: '校验 AGENTS.md、skills、extensions、packages payload' },
  { method: 'POST', path: '/api/agent/config', label: 'Apply', description: '远程写入 AGENTS.md，下载并替换 skills/extensions' },
]

const defaultRuntimeConfig: RuntimeConfig = {
  source: 'subAgent-pi runtime',
  configPath: 'GET /api/agent/profile + GET /api/agent/config',
  configSection: 'runtime APIs',
  enabled: true,
  chatPath: '/v1/chat/completions',
  timeoutSeconds: 600,
  apiKeyConfigured: false,
  templateProject: 'subAgent-pi',
  managementEndpoints: piMonoManagementEndpoints,
  lastSyncedAt: null,
  syncError: '',
}

const message = useMessage()

const agents = ref<SubAgentRecord[]>([])
const selectedAgentId = ref('')
const search = ref('')
const activeTab = ref<'overview' | 'agentsMd' | 'skills' | 'tools' | 'runtime' | 'deployments'>('overview')
const showCreateModal = ref(false)
const showPayloadModal = ref(false)
const validationMessage = ref('')
const validationOk = ref(false)
const isSyncing = ref(false)

const createForm = reactive({
  name: '',
  description: '',
  baseUrl: 'http://127.0.0.1:8767',
})

const selectedAgent = computed(() => agents.value.find(agent => agent.id === selectedAgentId.value) || agents.value[0] || null)

const filteredAgents = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return agents.value.filter(agent => {
    if (!keyword) return true
    return [
      agent.name,
      agent.description,
      agent.baseUrl,
      agent.runtimeConfig.source,
    ].some(value => value.toLowerCase().includes(keyword))
  })
})

const totalCalls = computed(() => agents.value.reduce((sum, agent) => sum + agent.callCount, 0))
const onlineCount = computed(() => agents.value.filter(agent => agent.status === 'online').length)

const configPayload = computed(() => {
  const agent = selectedAgent.value
  if (!agent) return {}
  return {
    mode: 'replace',
    agents_md: {
      content: agent.agentsMd,
    },
    skills: agent.skills
      .filter(item => item.source === 'draft' && isHttpUrl(item.url))
      .map(({ name, url }) => ({ name, url })),
    extensions: agent.tools
      .filter(item => item.source === 'draft' && isHttpUrl(item.url))
      .map(({ name, url }) => ({ name, url })),
    packages: agent.tools
      .filter(item => item.source === 'draft' && isHttpUrl(item.url))
      .map(item => item.name),
  }
})

watch(selectedAgentId, () => {
  activeTab.value = 'overview'
  validationMessage.value = ''
  validationOk.value = false
})

function cloneRuntimeConfig(patch: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    ...defaultRuntimeConfig,
    managementEndpoints: [...piMonoManagementEndpoints],
    ...patch,
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//.test(value.trim())
}

function formatTime(value: number | null): string {
  if (!value) return '尚未发布'
  return new Date(value).toLocaleString()
}

function formatSyncTime(value: number | null): string {
  if (!value) return '尚未同步'
  return new Date(value).toLocaleString()
}

function statusLabel(status: AgentStatus): string {
  if (status === 'online') return '在线'
  if (status === 'offline') return '离线'
  if (status === 'configured') return '已配置'
  return '草稿'
}

function statusType(status: AgentStatus) {
  if (status === 'online') return 'success'
  if (status === 'configured') return 'info'
  if (status === 'offline') return 'warning'
  return 'default'
}

function deploymentType(status: DeploymentStatus) {
  if (status === 'deployed') return 'success'
  if (status === 'validated') return 'info'
  return 'error'
}

function defaultAgentsMd(name: string, description: string): string {
  return [
    `# ${name || 'subAgent-pi 子智能体'}`,
    '',
    '## Agent Instructions',
    `- ${description || '根据 Hermes Studio 管理后台注入的配置、skills 和 extensions 完成任务。'}`,
    '- Operate within the mounted workspace unless the user explicitly asks otherwise.',
    '- Use available skills and extensions when they are relevant.',
    '- Before destructive operations, external sends, or permission changes, ask for confirmation.',
    '',
    '## Output',
    '- Report the steps taken, key result, failure reason if any, and next recommended action.',
    '- Mark uncertain information clearly instead of inventing details.',
  ].join('\n')
}

function createSeedAgent(input: {
  id: string
  name: string
  description: string
  baseUrl: string
  status: AgentStatus
  skills: AssetRef[]
  tools: AssetRef[]
  callCount: number
  successRate: number
  avgLatencyMs: number
  modelSummary: string
  lastRun: string
  lastPublishedAt: number | null
  runtimeConfig?: RuntimeConfig
}): SubAgentRecord {
  const now = Date.now()
  return {
    ...input,
    agentsMd: defaultAgentsMd(input.name, input.description),
    packages: input.tools.map(tool => tool.name),
    runtimeConfig: input.runtimeConfig || cloneRuntimeConfig({
      source: 'Hermes Studio draft',
      configPath: 'localStorage',
      configSection: 'frontend draft',
      enabled: input.status !== 'draft',
    }),
    deployments: input.lastPublishedAt
      ? [{
          id: `${input.id}-deploy-1`,
          status: 'deployed',
          message: '初始配置已发布到 subAgent-pi 运行时',
          createdAt: input.lastPublishedAt,
        }]
      : [],
    updatedAt: now,
  }
}

function seedAgents(): SubAgentRecord[] {
  return [
    createSeedAgent({
      id: 'pi-mono',
      name: 'pi-mono',
      description: '使用 subAgent-pi 项目构建的子智能体运行时，等待从远程接口同步配置。',
      baseUrl: 'http://172.16.50.149:8768',
      status: 'configured',
      skills: [],
      tools: [],
      callCount: 0,
      successRate: 0,
      avgLatencyMs: 0,
      modelSummary: '等待读取 /api/agent/profile',
      lastRun: '等待运行时同步',
      lastPublishedAt: null,
      runtimeConfig: cloneRuntimeConfig(),
    }),
  ]
}

function isLegacyDemoAgent(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<SubAgentRecord>
  const id = String(record.id || '')
  const name = String(record.name || '')
  return [
    'agent-data-analyst',
    'agent-document-ocr',
    'agent-reporting',
  ].includes(id) || [
    '经营问数 Agent',
    '单据解析 Agent',
    '报表编排 Agent',
  ].includes(name)
}

function normalizeAsset(value: Partial<AssetRef>, source: AssetSource): AssetRef {
  return {
    id: String(value.id || `${source}-${value.name || Date.now()}`),
    name: String(value.name || 'unnamed'),
    url: String(value.url || ''),
    description: String(value.description || value.path || ''),
    source: value.source || source,
    path: value.path,
    version: value.version,
  }
}

function normalizeStoredAgents(parsed: unknown): SubAgentRecord[] | null {
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  const piMonoSeed = seedAgents()[0]
  const cleaned = parsed.filter(agent => !isLegacyDemoAgent(agent))
  const normalized = cleaned.map((agent) => {
    const record = agent as Partial<SubAgentRecord> & { sourceConfig?: RuntimeConfig }
    return {
      ...piMonoSeed,
      ...record,
      skills: Array.isArray(record.skills) ? record.skills.map(item => normalizeAsset(item, item.source || 'runtime')) : [],
      tools: Array.isArray(record.tools) ? record.tools.map(item => normalizeAsset(item, item.source || 'runtime')) : [],
      packages: Array.isArray(record.packages) ? record.packages : [],
      runtimeConfig: cloneRuntimeConfig(record.runtimeConfig || record.sourceConfig || {}),
    } as SubAgentRecord
  })
  if (!normalized.some(agent => agent.id === piMonoSeed.id)) {
    normalized.unshift(piMonoSeed)
  }
  return normalized.length > 0 ? normalized : seedAgents()
}

function clearLegacyAgentDrafts() {
  for (const key of LEGACY_STORAGE_KEYS) {
    localStorage.removeItem(key)
  }
}

function resetToPiMonoSeed(showToast = false) {
  clearLegacyAgentDrafts()
  agents.value = seedAgents()
  selectedAgentId.value = agents.value[0]?.id || ''
  activeTab.value = 'overview'
  validationMessage.value = ''
  validationOk.value = false
  persistAgents()
  if (showToast) {
    message.success('已重置为 subAgent-pi pi-mono 运行时')
  }
}

function loadAgents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const normalized = normalizeStoredAgents(parsed)
      if (normalized) {
        clearLegacyAgentDrafts()
        agents.value = normalized
        selectedAgentId.value = agents.value[0].id
        persistAgents()
        return
      }
    }
  } catch {
    // fall back to seed runtime
  }
  resetToPiMonoSeed()
}

function persistAgents() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(agents.value))
}

function updateAgent(id: string, patch: Partial<SubAgentRecord>) {
  agents.value = agents.value.map(item => (
    item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item
  ))
  persistAgents()
}

function updateSelected(patch: Partial<SubAgentRecord>) {
  const agent = selectedAgent.value
  if (!agent) return
  updateAgent(agent.id, patch)
}

function selectAgent(id: string) {
  selectedAgentId.value = id
}

function openCreateModal() {
  createForm.name = ''
  createForm.description = ''
  createForm.baseUrl = 'http://127.0.0.1:8767'
  showCreateModal.value = true
}

function createAgent() {
  const name = createForm.name.trim()
  const baseUrl = createForm.baseUrl.trim()
  if (!name) {
    message.error('请输入子智能体名称')
    return
  }
  if (baseUrl && !isHttpUrl(baseUrl)) {
    message.error('远程 base URL 必须以 http:// 或 https:// 开头')
    return
  }
  const id = `agent-${Date.now().toString(36)}`
  const description = createForm.description.trim() || '等待从 subAgent-pi 运行时同步配置。'
  const agent = createSeedAgent({
    id,
    name,
    description,
    baseUrl,
    status: baseUrl ? 'configured' : 'draft',
    skills: [],
    tools: [],
    callCount: 0,
    successRate: 0,
    avgLatencyMs: 0,
    modelSummary: '未连接',
    lastRun: '尚未同步',
    lastPublishedAt: null,
    runtimeConfig: cloneRuntimeConfig({
      source: baseUrl ? 'subAgent-pi runtime' : 'Hermes Studio draft',
      enabled: Boolean(baseUrl),
    }),
  })
  agents.value = [agent, ...agents.value]
  selectedAgentId.value = agent.id
  persistAgents()
  showCreateModal.value = false
  message.success('子智能体草稿已创建')
}

function addAsset(kind: 'skills' | 'tools', asset: AssetRef) {
  const agent = selectedAgent.value
  if (!agent) return
  const current = agent[kind]
  if (current.some(item => item.name === asset.name && item.url === asset.url)) {
    message.info(`${asset.name} 已在当前配置中`)
    return
  }
  const next = [...current, { ...asset, id: `${asset.id}-${Date.now()}` }]
  const patch: Partial<SubAgentRecord> = kind === 'tools'
    ? { tools: next, packages: next.filter(item => item.source === 'draft').map(item => item.name) }
    : { skills: next }
  updateSelected(patch)
}

function addCustomAsset(kind: 'skills' | 'tools') {
  const name = window.prompt(kind === 'skills' ? '技能名称' : '工具名称')
  if (!name?.trim()) return
  const url = window.prompt('ZIP URL')
  if (!url?.trim()) return
  if (!isHttpUrl(url)) {
    message.error('ZIP URL 必须以 http:// 或 https:// 开头')
    return
  }
  addAsset(kind, {
    id: `draft-${Date.now()}`,
    name: name.trim(),
    url: url.trim(),
    description: '准备注入到 subAgent-pi 的远程 ZIP 资产',
    source: 'draft',
  })
}

function removeAsset(kind: 'skills' | 'tools', id: string) {
  const agent = selectedAgent.value
  if (!agent) return
  const next = agent[kind].filter(item => item.id !== id)
  const patch: Partial<SubAgentRecord> = kind === 'tools'
    ? { tools: next, packages: next.filter(item => item.source === 'draft').map(item => item.name) }
    : { skills: next }
  updateSelected(patch)
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function runtimeAssetToRef(asset: RuntimeAsset, kind: 'skill' | 'extension', index: number): AssetRef {
  const name = asset.name || asset.path?.split('/').filter(Boolean).at(-1) || `${kind}-${index + 1}`
  const details = [
    asset.description,
    asset.version ? `version: ${asset.version}` : '',
    asset.path ? `path: ${asset.path}` : '',
  ].filter(Boolean).join(' · ')
  return {
    id: `runtime-${kind}-${name}-${index}`,
    name,
    url: asset.url || '',
    description: details || '运行时已安装资产',
    source: 'runtime',
    path: asset.path,
    version: asset.version,
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

async function fetchRuntimeJson<T>(baseUrl: string, path: string): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    })
    if (!response.ok) {
      throw new Error(`${path} returned ${response.status}`)
    }
    return await response.json() as T
  } finally {
    window.clearTimeout(timer)
  }
}

async function syncRuntimeConfig(agent = selectedAgent.value, showToast = true) {
  if (!agent) return
  const baseUrl = normalizeBaseUrl(agent.baseUrl)
  if (!baseUrl || !isHttpUrl(baseUrl)) {
    message.error('请先配置有效的 subAgent-pi base URL')
    return
  }

  isSyncing.value = true
  try {
    await fetchRuntimeJson<unknown>(baseUrl, '/health').catch(() => null)
    const [profile, config] = await Promise.all([
      fetchRuntimeJson<RuntimeAgentProfile>(baseUrl, '/api/agent/profile'),
      fetchRuntimeJson<RuntimeConfigSummary>(baseUrl, '/api/agent/config').catch(() => null),
    ])
    const runtimeSkills = (profile.skills || config?.skills || []).map((item, index) => runtimeAssetToRef(item, 'skill', index))
    const runtimeTools = (profile.extensions || config?.extensions || []).map((item, index) => runtimeAssetToRef(item, 'extension', index))
    const draftSkills = agent.skills.filter(item => item.source === 'draft')
    const draftTools = agent.tools.filter(item => item.source === 'draft')
    const agentsMd = profile.agents_md?.content || config?.agents_md?.content || agent.agentsMd
    const packages = profile.packages || config?.packages || draftTools.map(item => item.name)

    updateAgent(agent.id, {
      name: profile.name || agent.name,
      description: profile.description || agent.description,
      baseUrl,
      status: 'online',
      agentsMd,
      skills: [...runtimeSkills, ...draftSkills],
      tools: [...runtimeTools, ...draftTools],
      packages,
      modelSummary: profile.model_summary || agent.modelSummary || '未返回模型摘要',
      lastRun: '刚刚同步运行时配置',
      runtimeConfig: cloneRuntimeConfig({
        ...agent.runtimeConfig,
        source: 'subAgent-pi runtime',
        enabled: true,
        lastSyncedAt: Date.now(),
        syncError: '',
      }),
    })
    if (showToast) {
      message.success('已从 subAgent-pi 运行时同步配置')
    }
  } catch (error) {
    const syncError = getErrorMessage(error)
    updateAgent(agent.id, {
      baseUrl,
      status: 'offline',
      runtimeConfig: cloneRuntimeConfig({
        ...agent.runtimeConfig,
        source: 'subAgent-pi runtime',
        lastSyncedAt: agent.runtimeConfig.lastSyncedAt,
        syncError,
      }),
    })
    if (showToast) {
      message.error(`同步失败：${syncError}`)
    }
  } finally {
    isSyncing.value = false
  }
}

function validateCurrentAgent() {
  const agent = selectedAgent.value
  if (!agent) return
  const errors: string[] = []
  if (!agent.name.trim()) errors.push('缺少名称')
  if (!agent.baseUrl.trim()) errors.push('缺少远程 base URL')
  if (!isHttpUrl(agent.baseUrl.trim())) errors.push('远程 URL 必须以 http:// 或 https:// 开头')
  if (!agent.agentsMd.trim()) errors.push('AGENTS.md 不能为空')
  for (const item of [...agent.skills, ...agent.tools]) {
    if (!item.name.trim()) errors.push('技能/工具名称不能为空')
    if (item.source === 'draft' && !isHttpUrl(item.url)) errors.push(`${item.name} 的 ZIP URL 无效`)
  }
  if (errors.length > 0) {
    validationOk.value = false
    validationMessage.value = errors.join('；')
    message.error(validationMessage.value)
    return
  }
  validationOk.value = true
  validationMessage.value = '前端预检通过；接入后端后将调用 subAgent-pi /api/agent/config/validate'
  const record: DeploymentRecord = {
    id: `validate-${Date.now()}`,
    status: 'validated',
    message: validationMessage.value,
    createdAt: Date.now(),
  }
  updateSelected({ deployments: [record, ...agent.deployments] })
  message.success('预检通过')
}

function simulateDeploy() {
  const agent = selectedAgent.value
  if (!agent) return
  if (!validationOk.value) {
    validateCurrentAgent()
    if (!validationOk.value) return
  }
  const record: DeploymentRecord = {
    id: `deploy-${Date.now()}`,
    status: 'deployed',
    message: '模拟发布成功；后端接入后将调用 subAgent-pi /api/agent/config',
    createdAt: Date.now(),
  }
  updateSelected({
    status: 'online',
    lastPublishedAt: Date.now(),
    deployments: [record, ...agent.deployments],
  })
  message.success('已模拟发布')
}

async function copyPayload() {
  const ok = await copyToClipboard(JSON.stringify(configPayload.value, null, 2))
  if (ok) message.success('Payload 已复制')
  else message.error('复制失败')
}

onMounted(() => {
  loadAgents()
  void syncRuntimeConfig(selectedAgent.value, false)
})
</script>

<template>
  <div class="sub-agents-view">
    <header class="page-header">
      <div class="header-text">
        <h2 class="header-title">子智能体管理</h2>
        <p class="header-subtitle">连接 subAgent-pi 运行时，读取配置并管理 AGENTS.md、skills、extensions 的注入草稿。</p>
      </div>
      <div class="header-actions">
        <NButton size="small" :loading="isSyncing" @click="syncRuntimeConfig(selectedAgent, true)">同步运行时</NButton>
        <NButton size="small" @click="resetToPiMonoSeed(true)">重置 pi-mono</NButton>
        <NButton size="small" @click="showPayloadModal = true">查看 Payload</NButton>
        <NButton type="primary" size="small" @click="openCreateModal">新建智能体</NButton>
      </div>
    </header>

    <main class="sub-agents-shell">
      <aside class="agent-list-pane">
        <div class="overview-strip">
          <div>
            <strong>{{ agents.length }}</strong>
            <span>智能体</span>
          </div>
          <div>
            <strong>{{ onlineCount }}</strong>
            <span>在线</span>
          </div>
          <div>
            <strong>{{ totalCalls }}</strong>
            <span>调用</span>
          </div>
        </div>

        <div class="list-controls">
          <NInput v-model:value="search" size="small" clearable placeholder="搜索名称、描述或 URL" />
        </div>

        <div class="agent-list">
          <button
            v-for="agent in filteredAgents"
            :key="agent.id"
            class="agent-row"
            :class="{ active: selectedAgent?.id === agent.id }"
            type="button"
            @click="selectAgent(agent.id)"
          >
            <span class="agent-row-main">
              <span class="agent-row-title">{{ agent.name }}</span>
              <span class="agent-row-meta">{{ agent.baseUrl || agent.runtimeConfig.source }}</span>
            </span>
            <NTag size="small" :type="statusType(agent.status)" round>{{ statusLabel(agent.status) }}</NTag>
          </button>
          <div v-if="filteredAgents.length === 0" class="empty-list">没有匹配的子智能体</div>
        </div>
      </aside>

      <section v-if="selectedAgent" class="agent-detail-pane">
        <div class="detail-header">
          <div>
            <div class="detail-kicker">{{ selectedAgent.runtimeConfig.templateProject }}</div>
            <h3>{{ selectedAgent.name }}</h3>
            <p>{{ selectedAgent.description }}</p>
          </div>
          <div class="detail-actions">
            <NTag :type="statusType(selectedAgent.status)" round>{{ statusLabel(selectedAgent.status) }}</NTag>
            <NButton size="small" :loading="isSyncing" @click="syncRuntimeConfig(selectedAgent, true)">同步配置</NButton>
            <NButton size="small" @click="validateCurrentAgent">预检</NButton>
            <NButton type="primary" size="small" @click="simulateDeploy">模拟发布</NButton>
          </div>
        </div>

        <div class="tabs" role="tablist" aria-label="子智能体详情">
          <button :class="{ active: activeTab === 'overview' }" type="button" @click="activeTab = 'overview'">概览</button>
          <button :class="{ active: activeTab === 'agentsMd' }" type="button" @click="activeTab = 'agentsMd'">AGENTS.md</button>
          <button :class="{ active: activeTab === 'skills' }" type="button" @click="activeTab = 'skills'">Skills</button>
          <button :class="{ active: activeTab === 'tools' }" type="button" @click="activeTab = 'tools'">Extensions</button>
          <button :class="{ active: activeTab === 'runtime' }" type="button" @click="activeTab = 'runtime'">运行详情</button>
          <button :class="{ active: activeTab === 'deployments' }" type="button" @click="activeTab = 'deployments'">发布记录</button>
        </div>

        <div v-if="validationMessage" class="inline-state" :class="{ ok: validationOk }">
          {{ validationMessage }}
        </div>

        <div v-if="activeTab === 'overview'" class="detail-grid">
          <section class="panel span-2">
            <div class="panel-title">基础配置</div>
            <label>
              <span>名称</span>
              <NInput :value="selectedAgent.name" @update:value="value => updateSelected({ name: value })" />
            </label>
            <label>
              <span>描述</span>
              <NInput
                type="textarea"
                :autosize="{ minRows: 2, maxRows: 4 }"
                :value="selectedAgent.description"
                @update:value="value => updateSelected({ description: value })"
              />
            </label>
            <label>
              <span>subAgent-pi base URL</span>
              <NInput :value="selectedAgent.baseUrl" placeholder="http://127.0.0.1:8767" @update:value="value => updateSelected({ baseUrl: value })" />
            </label>
            <div class="source-line">
              <span>配置来源</span>
              <strong>{{ selectedAgent.runtimeConfig.source }}</strong>
            </div>
            <div class="source-line">
              <span>读取方式</span>
              <code>{{ selectedAgent.runtimeConfig.configPath }}</code>
            </div>
          </section>

          <section class="panel metrics-panel">
            <div class="panel-title">调用量</div>
            <div class="metric">
              <strong>{{ selectedAgent.callCount }}</strong>
              <span>总调用</span>
            </div>
            <div class="metric-line">
              <span>成功率</span>
              <strong>{{ selectedAgent.successRate ? `${selectedAgent.successRate}%` : '—' }}</strong>
            </div>
            <div class="metric-line">
              <span>平均耗时</span>
              <strong>{{ selectedAgent.avgLatencyMs ? `${selectedAgent.avgLatencyMs}ms` : '—' }}</strong>
            </div>
          </section>

          <section class="panel">
            <div class="panel-title">构建摘要</div>
            <div class="summary-list">
              <div><span>Skills</span><strong>{{ selectedAgent.skills.length }}</strong></div>
              <div><span>Extensions</span><strong>{{ selectedAgent.tools.length }}</strong></div>
              <div><span>Packages</span><strong>{{ selectedAgent.packages.length }}</strong></div>
              <div><span>最后运行</span><strong>{{ selectedAgent.lastRun }}</strong></div>
            </div>
          </section>

          <section class="panel span-2">
            <div class="panel-title">运行时同步</div>
            <div class="runtime-config-grid">
              <div>
                <span>构建项目</span>
                <strong>{{ selectedAgent.runtimeConfig.templateProject }}</strong>
              </div>
              <div>
                <span>接口根地址</span>
                <strong>{{ selectedAgent.baseUrl || '未配置' }}</strong>
              </div>
              <div>
                <span>上次同步</span>
                <strong>{{ formatSyncTime(selectedAgent.runtimeConfig.lastSyncedAt) }}</strong>
              </div>
              <div>
                <span>同步状态</span>
                <strong>{{ selectedAgent.runtimeConfig.syncError || '正常' }}</strong>
              </div>
            </div>
          </section>
        </div>

        <section v-else-if="activeTab === 'agentsMd'" class="panel fill-panel">
          <div class="panel-title-row">
            <div>
              <div class="panel-title">AGENTS.md</div>
              <p>同步后展示运行时返回的内容；发布时会写入 subAgent-pi 的 AGENTS.md。</p>
            </div>
            <NButton size="small" @click="updateSelected({ agentsMd: defaultAgentsMd(selectedAgent.name, selectedAgent.description) })">
              重新生成
            </NButton>
          </div>
          <NInput
            type="textarea"
            class="agents-md-editor"
            :autosize="{ minRows: 18 }"
            :value="selectedAgent.agentsMd"
            @update:value="value => updateSelected({ agentsMd: value })"
          />
        </section>

        <section v-else-if="activeTab === 'skills'" class="panel fill-panel">
          <div class="panel-title-row">
            <div>
              <div class="panel-title">Skills</div>
              <p>运行时已安装 skills 只展示；手动添加 ZIP URL 后才会进入下一次 config 注入 payload。</p>
            </div>
            <NButton size="small" @click="addCustomAsset('skills')">添加 URL</NButton>
          </div>
          <div class="asset-list">
            <div v-for="asset in selectedAgent.skills" :key="asset.id" class="asset-row">
              <div>
                <strong>{{ asset.name }}</strong>
                <span>{{ asset.description || asset.url || '无描述' }}</span>
              </div>
              <div class="asset-actions">
                <NTag size="small" :type="asset.source === 'runtime' ? 'info' : 'warning'">{{ asset.source }}</NTag>
                <NButton v-if="asset.source === 'draft'" size="tiny" quaternary type="error" @click="removeAsset('skills', asset.id)">移除</NButton>
              </div>
            </div>
            <div v-if="selectedAgent.skills.length === 0" class="empty-inline">运行时暂未返回 skills</div>
          </div>
        </section>

        <section v-else-if="activeTab === 'tools'" class="panel fill-panel">
          <div class="panel-title-row">
            <div>
              <div class="panel-title">Extensions</div>
              <p>运行时已安装 extensions 只展示；手动添加 ZIP URL 后会同步生成 packages 注入草稿。</p>
            </div>
            <NButton size="small" @click="addCustomAsset('tools')">添加 URL</NButton>
          </div>
          <div class="asset-list">
            <div v-for="asset in selectedAgent.tools" :key="asset.id" class="asset-row">
              <div>
                <strong>{{ asset.name }}</strong>
                <span>{{ asset.description || asset.url || '无描述' }}</span>
              </div>
              <div class="asset-actions">
                <NTag size="small" :type="asset.source === 'runtime' ? 'info' : 'warning'">{{ asset.source }}</NTag>
                <NButton v-if="asset.source === 'draft'" size="tiny" quaternary type="error" @click="removeAsset('tools', asset.id)">移除</NButton>
              </div>
            </div>
            <div v-if="selectedAgent.tools.length === 0" class="empty-inline">运行时暂未返回 extensions</div>
            <div class="packages-line">
              <span>packages</span>
              <code>{{ selectedAgent.packages.length ? selectedAgent.packages.join(', ') : '[]' }}</code>
            </div>
          </div>
        </section>

        <section v-else-if="activeTab === 'runtime'" class="detail-grid">
          <div class="panel">
            <div class="panel-title">远程连接</div>
            <div class="runtime-row"><span>Health</span><NTag :type="statusType(selectedAgent.status)" size="small">{{ statusLabel(selectedAgent.status) }}</NTag></div>
            <div class="runtime-row"><span>Base URL</span><strong>{{ selectedAgent.baseUrl || '未配置' }}</strong></div>
            <div class="runtime-row"><span>Chat Path</span><strong>{{ selectedAgent.runtimeConfig.chatPath }}</strong></div>
            <div class="runtime-row"><span>超时</span><strong>{{ selectedAgent.runtimeConfig.timeoutSeconds }}s</strong></div>
            <div class="runtime-row"><span>模型摘要</span><strong>{{ selectedAgent.modelSummary }}</strong></div>
            <div class="runtime-row"><span>上次同步</span><strong>{{ formatSyncTime(selectedAgent.runtimeConfig.lastSyncedAt) }}</strong></div>
          </div>
          <div class="panel">
            <div class="panel-title">能力详情</div>
            <div class="runtime-row"><span>远程 skills</span><strong>{{ selectedAgent.skills.filter(item => item.source === 'runtime').map(item => item.name).join(', ') || '未安装' }}</strong></div>
            <div class="runtime-row"><span>远程 extensions</span><strong>{{ selectedAgent.tools.filter(item => item.source === 'runtime').map(item => item.name).join(', ') || '未安装' }}</strong></div>
            <div class="runtime-row"><span>API Key</span><strong>{{ selectedAgent.runtimeConfig.apiKeyConfigured ? '已配置' : '未配置' }}</strong></div>
            <div class="runtime-row"><span>构建项目</span><strong>{{ selectedAgent.runtimeConfig.templateProject }}</strong></div>
          </div>
          <div v-if="selectedAgent.runtimeConfig.syncError" class="panel span-2">
            <div class="panel-title">同步错误</div>
            <p class="error-text">{{ selectedAgent.runtimeConfig.syncError }}</p>
          </div>
          <div class="panel span-2 endpoint-panel">
            <div class="panel-title">subAgent-pi 管理 API</div>
            <div class="endpoint-list">
              <div v-for="endpoint in selectedAgent.runtimeConfig.managementEndpoints" :key="`${endpoint.method}-${endpoint.path}`" class="endpoint-row">
                <NTag size="small" :type="endpoint.method === 'POST' ? 'warning' : 'info'">{{ endpoint.method }}</NTag>
                <div>
                  <strong>{{ endpoint.path }}</strong>
                  <span>{{ endpoint.label }} · {{ endpoint.description }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section v-else class="panel fill-panel">
          <div class="panel-title">发布记录</div>
          <div v-for="record in selectedAgent.deployments" :key="record.id" class="deployment-row">
            <NTag size="small" :type="deploymentType(record.status)">{{ record.status }}</NTag>
            <div>
              <strong>{{ record.message }}</strong>
              <span>{{ formatTime(record.createdAt) }}</span>
            </div>
          </div>
          <div v-if="selectedAgent.deployments.length === 0" class="empty-inline">暂无发布记录</div>
        </section>
      </section>
    </main>

    <NModal v-model:show="showCreateModal" preset="dialog" title="新建子智能体" style="width: 620px;">
      <div class="create-form">
        <label>
          <span>名称</span>
          <NInput v-model:value="createForm.name" placeholder="例如：pi-finance" />
        </label>
        <label>
          <span>描述</span>
          <NInput v-model:value="createForm.description" type="textarea" :autosize="{ minRows: 3, maxRows: 5 }" />
        </label>
        <label>
          <span>subAgent-pi base URL</span>
          <NInput v-model:value="createForm.baseUrl" placeholder="http://127.0.0.1:8767" />
        </label>
      </div>
      <template #action>
        <NButton @click="showCreateModal = false">取消</NButton>
        <NButton type="primary" @click="createAgent">创建草稿</NButton>
      </template>
    </NModal>

    <NModal v-model:show="showPayloadModal" preset="dialog" title="subAgent-pi Config Payload" style="width: 760px;">
      <pre class="payload-preview">{{ JSON.stringify(configPayload, null, 2) }}</pre>
      <template #action>
        <NButton @click="showPayloadModal = false">关闭</NButton>
        <NButton type="primary" @click="copyPayload">复制</NButton>
      </template>
    </NModal>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.sub-agents-view {
  height: calc(100 * var(--vh));
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.page-header {
  flex: 0 0 auto;
}

.header-text {
  min-width: 0;
}

.header-subtitle {
  margin: 4px 0 0;
  color: $text-secondary;
  font-size: 13px;
  line-height: 1.5;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.sub-agents-shell {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 16px;
  padding: 16px 20px 20px;
  overflow: hidden;
}

.agent-list-pane,
.agent-detail-pane,
.panel {
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
}

.agent-list-pane {
  min-height: 0;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.overview-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;

  div {
    min-width: 0;
    padding: 10px;
    border-radius: $radius-sm;
    background: rgba(var(--accent-primary-rgb), 0.05);
  }

  strong {
    display: block;
    color: $text-primary;
    font-size: 18px;
    line-height: 24px;
  }

  span {
    color: $text-secondary;
    font-size: 12px;
  }
}

.list-controls {
  display: grid;
  gap: 8px;
}

.agent-list {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.agent-row {
  width: 100%;
  min-height: 58px;
  border: 1px solid transparent;
  border-radius: $radius-sm;
  background: transparent;
  color: $text-primary;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 10px;
  cursor: pointer;
  text-align: left;

  &:hover,
  &.active {
    border-color: rgba(var(--accent-primary-rgb), 0.18);
    background: rgba(var(--accent-primary-rgb), 0.06);
  }
}

.agent-row-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.agent-row-title,
.agent-row-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-row-title {
  font-weight: 650;
}

.agent-row-meta {
  color: $text-secondary;
  font-size: 12px;
}

.empty-list,
.empty-inline {
  color: $text-muted;
  font-size: 13px;
  padding: 16px;
  text-align: center;
}

.agent-detail-pane {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;

  h3 {
    margin: 2px 0 4px;
    font-size: 22px;
    line-height: 30px;
  }

  p {
    margin: 0;
    color: $text-secondary;
    line-height: 1.5;
  }
}

.detail-kicker {
  color: $text-muted;
  font-size: 12px;
  font-weight: 650;
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.tabs {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: $radius-sm;
  background: rgba(var(--accent-primary-rgb), 0.05);
  margin-bottom: 12px;
  overflow-x: auto;

  button {
    min-height: 32px;
    border: none;
    border-radius: 5px;
    padding: 6px 12px;
    background: transparent;
    color: $text-secondary;
    cursor: pointer;
    white-space: nowrap;
  }

  button.active {
    background: $bg-card;
    color: $text-primary;
    font-weight: 650;
  }
}

.inline-state {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: $radius-sm;
  color: var(--error);
  background: rgba(var(--error-rgb), 0.08);

  &.ok {
    color: var(--success);
    background: rgba(var(--success-rgb), 0.08);
  }
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.panel {
  min-width: 0;
  padding: 14px;
}

.span-2 {
  grid-column: span 2;
}

.fill-panel {
  min-height: 420px;
}

.panel-title,
.panel-title-row .panel-title {
  font-size: 14px;
  font-weight: 700;
  color: $text-primary;
  margin-bottom: 10px;
}

.panel-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;

  p {
    margin: -6px 0 0;
    color: $text-secondary;
    font-size: 13px;
    line-height: 1.5;
  }
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

.metrics-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.metric strong {
  display: block;
  font-size: 32px;
  line-height: 36px;
}

.metric span,
.metric-line span,
.summary-list span,
.runtime-config-grid span {
  color: $text-secondary;
  font-size: 12px;
}

.metric-line,
.summary-list div,
.runtime-row,
.source-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid $border-light;
}

.summary-list strong,
.runtime-row strong,
.source-line strong,
.source-line code {
  min-width: 0;
  text-align: right;
  overflow-wrap: anywhere;
}

.source-line span {
  color: $text-secondary;
  font-size: 12px;
}

.source-line code {
  font-family: $font-code;
  color: $text-secondary;
  font-size: 12px;
}

.runtime-config-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  div {
    min-width: 0;
    padding: 10px;
    border: 1px solid $border-light;
    border-radius: $radius-sm;
    background: $bg-primary;
  }

  strong,
  span {
    display: block;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  strong {
    margin-top: 4px;
  }
}

.error-text {
  margin: 0;
  color: var(--error);
  overflow-wrap: anywhere;
}

.endpoint-panel {
  min-height: 0;
}

.endpoint-list {
  display: grid;
  gap: 8px;
}

.endpoint-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  border: 1px solid $border-light;
  border-radius: $radius-sm;
  background: $bg-primary;

  strong,
  span {
    display: block;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  strong {
    font-family: $font-code;
    font-size: 13px;
  }

  span {
    margin-top: 3px;
    color: $text-secondary;
    font-size: 12px;
    line-height: 1.45;
  }
}

.agents-md-editor :deep(textarea) {
  font-family: $font-code;
  font-size: 13px;
  line-height: 1.55;
}

.asset-list {
  display: grid;
  gap: 8px;
}

.asset-row,
.deployment-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px;
  border: 1px solid $border-light;
  border-radius: $radius-sm;

  div {
    min-width: 0;
  }

  strong,
  span {
    display: block;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  span {
    color: $text-secondary;
    font-size: 12px;
    margin-top: 3px;
  }
}

.asset-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex: 0 0 auto;
}

.packages-line {
  margin-top: 4px;
  padding: 10px;
  border-radius: $radius-sm;
  background: rgba(var(--accent-primary-rgb), 0.05);

  span,
  code {
    display: block;
  }

  span {
    color: $text-secondary;
    font-size: 12px;
    margin-bottom: 4px;
  }
}

.create-form {
  display: grid;
  gap: 10px;
}

.payload-preview {
  max-height: 420px;
  overflow: auto;
  padding: 12px;
  border-radius: $radius-sm;
  background: $code-bg;
  color: $text-primary;
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 1100px) {
  .sub-agents-shell {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .agent-list-pane,
  .agent-detail-pane {
    overflow: visible;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }

  .span-2 {
    grid-column: span 1;
  }
}

@media (max-width: 760px) {
  .sub-agents-shell {
    padding: 12px;
  }

  .detail-header,
  .panel-title-row {
    flex-direction: column;
  }

  .detail-actions {
    justify-content: flex-start;
  }

  .runtime-config-grid {
    grid-template-columns: 1fr;
  }

  .asset-row {
    flex-direction: column;
  }

  .asset-actions {
    justify-content: flex-start;
  }
}
</style>
