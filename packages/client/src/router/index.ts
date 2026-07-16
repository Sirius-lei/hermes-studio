import { createRouter, createWebHashHistory } from 'vue-router'
import { hasApiKey, isStoredSuperAdmin, setActiveUserContextId } from '@/api/client'

function normalizeUserContextQuery(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized || null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) return item.trim()
    }
  }
  return null
}

function isDiTingRouteName(name: unknown): name is string {
  return typeof name === 'string' && name.startsWith('DiTing.')
}

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/DiTing/chat',
      name: 'DiTing.chat',
      component: () => import('@/views/DiTing/ChatView.vue'),
    },
    {
      path: '/DiTing/session/:sessionId',
      name: 'DiTing.session',
      component: () => import('@/views/DiTing/ChatView.vue'),
    },
    {
      path: '/DiTing/history',
      name: 'DiTing.history',
      component: () => import('@/views/DiTing/HistoryView.vue'),
    },
    {
      path: '/DiTing/history/session/:sessionId',
      name: 'DiTing.historySession',
      component: () => import('@/views/DiTing/HistoryView.vue'),
    },
    {
      path: '/DiTing/global-agent',
      name: 'DiTing.globalAgent',
      component: () => import('@/views/DiTing/GlobalAgentView.vue'),
    },
    {
      path: '/DiTing/global-agent/session/:sessionId',
      name: 'DiTing.globalAgentSession',
      component: () => import('@/views/DiTing/GlobalAgentView.vue'),
    },
    {
      path: '/DiTing/jobs',
      name: 'DiTing.jobs',
      component: () => import('@/views/DiTing/JobsView.vue'),
    },
    {
      path: '/DiTing/kanban',
      name: 'DiTing.kanban',
      component: () => import('@/views/DiTing/KanbanView.vue'),
    },
    {
      path: '/DiTing/workflow',
      name: 'DiTing.workflow',
      component: () => import('@/views/DiTing/WorkflowView.vue'),
    },
    {
      path: '/DiTing/task-plans',
      name: 'DiTing.taskPlans',
      redirect: { name: 'DiTing.chat' },
    },
    {
      path: '/DiTing/sub-agents',
      name: 'DiTing.subAgents',
      component: () => import('@/views/DiTing/SubAgentsView.vue'),
    },
    {
      path: '/DiTing/models',
      name: 'DiTing.models',
      component: () => import('@/views/DiTing/ModelsView.vue'),
    },
    {
      path: '/DiTing/profiles',
      name: 'DiTing.profiles',
      component: () => import('@/views/DiTing/ProfilesView.vue'),
      meta: { requiresSuperAdmin: true },
    },
    {
      path: '/DiTing/logs',
      name: 'DiTing.logs',
      component: () => import('@/views/DiTing/LogsView.vue'),
    },
    {
      path: '/DiTing/usage',
      name: 'DiTing.usage',
      component: () => import('@/views/DiTing/UsageView.vue'),
    },
    {
      path: '/DiTing/performance',
      name: 'DiTing.performance',
      component: () => import('@/views/DiTing/PerformanceView.vue'),
      meta: { requiresSuperAdmin: true },
    },
    {
      path: '/DiTing/skills-usage',
      name: 'DiTing.skillsUsage',
      component: () => import('@/views/DiTing/SkillsUsageView.vue'),
    },
    {
      path: '/DiTing/skills',
      name: 'DiTing.skills',
      component: () => import('@/views/DiTing/SkillsView.vue'),
    },
    {
      path: '/DiTing/plugins',
      name: 'DiTing.plugins',
      component: () => import('@/views/DiTing/PluginsView.vue'),
    },
    {
      path: '/DiTing/memory',
      name: 'DiTing.memory',
      component: () => import('@/views/DiTing/MemoryView.vue'),
    },
    {
      path: '/DiTing/settings',
      name: 'DiTing.settings',
      component: () => import('@/views/DiTing/SettingsView.vue'),
      meta: { requiresSuperAdmin: true },
    },
    {
      path: '/DiTing/channels',
      name: 'DiTing.channels',
      component: () => import('@/views/DiTing/ChannelsView.vue'),
    },
    {
      path: '/DiTing/terminal',
      name: 'DiTing.terminal',
      component: () => import('@/views/DiTing/TerminalView.vue'),
      meta: { requiresSuperAdmin: true },
    },
    {
      path: '/DiTing/devices',
      name: 'DiTing.devices',
      component: () => import('@/views/DiTing/DevicesView.vue'),
    },
    {
      path: '/DiTing/group-chat',
      name: 'DiTing.groupChat',
      component: () => import('@/views/DiTing/GroupChatView.vue'),
    },
    {
      path: '/DiTing/group-chat/room/:roomId',
      name: 'DiTing.groupChatRoom',
      component: () => import('@/views/DiTing/GroupChatView.vue'),
    },
    {
      path: '/DiTing/files',
      name: 'DiTing.files',
      component: () => import('@/views/DiTing/FilesView.vue'),
    },
    {
      path: '/DiTing/coding-agents',
      name: 'DiTing.codingAgents',
      component: () => import('@/views/DiTing/CodingAgentsView.vue'),
    },
    {
      path: '/DiTing/version-preview',
      name: 'DiTing.versionPreview',
      component: () => import('@/views/DiTing/VersionPreviewView.vue'),
      meta: { requiresSuperAdmin: true },
    },
    {
      path: '/DiTing/mcp',
      name: 'DiTing.mcp',
      component: () => import('@/views/DiTing/McpManagerView.vue'),
      meta: { requiresSuperAdmin: true },
    },
  ],
})

router.beforeEach((to, from, next) => {
  const incomingUserContext = normalizeUserContextQuery(to.query.user_id)
  const previousUserContext = normalizeUserContextQuery(from.query.user_id)

  if (isDiTingRouteName(to.name) && !incomingUserContext && previousUserContext) {
    setActiveUserContextId(previousUserContext)
    next({
      name: to.name,
      params: to.params,
      query: { ...to.query, user_id: previousUserContext },
      hash: to.hash,
      replace: true,
    })
    return
  }

  setActiveUserContextId(isDiTingRouteName(to.name) ? incomingUserContext : null)

  // Public pages don't need auth
  if (to.meta.public) {
    // Already has key, skip login
    if (to.name === 'login' && hasApiKey()) {
      next({ path: '/DiTing/chat' })
      return
    }
    next()
    return
  }

  // All other pages require token
  if (!hasApiKey()) {
    next({ name: 'login' })
    return
  }

  if (to.meta.requiresSuperAdmin && !isStoredSuperAdmin()) {
    next({ name: 'DiTing.chat' })
    return
  }

  next()
})

export default router
