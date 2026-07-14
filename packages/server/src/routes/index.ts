import type { Context, Next } from 'koa'

// Shared route modules
import { healthRoutes } from './health'
import { webhookRoutes } from './webhook'
import { uploadRoutes } from './upload'
import { updateRoutes } from './update'
import { authPublicRoutes, authProtectedRoutes } from './auth'
import { devicePublicRoutes, deviceRoutes } from './devices'
import { codingAgentRoutes } from './coding-agents'
import { apiDocsRoutes } from './api-docs'
import { claudeCodeProxyRoutes } from './claude-code-proxy'
import { codexProxyRoutes } from './codex-proxy'

// DiTing route modules
import { sessionRoutes } from './DiTing/sessions'
import { profileRoutes } from './DiTing/profiles'
import { skillRoutes } from './DiTing/skills'
import { pluginRoutes } from './DiTing/plugins'
import { memoryRoutes } from './DiTing/memory'
import { modelRoutes } from './DiTing/models'
import { providerRoutes } from './DiTing/providers'
import { configRoutes } from './DiTing/config'
import { logRoutes } from './DiTing/logs'
import { codexAuthRoutes } from './DiTing/codex-auth'
import { nousAuthRoutes } from './DiTing/nous-auth'
import { copilotAuthRoutes } from './DiTing/copilot-auth'
import { xaiAuthRoutes } from './DiTing/xai-auth'
import { anthropicAuthRoutes } from './DiTing/anthropic-auth'
import { geminiAuthRoutes } from './DiTing/gemini-auth'
import { weixinRoutes } from './DiTing/weixin'
import { fileRoutes } from './DiTing/files'
import { downloadRoutes } from './DiTing/download'
import { jobRoutes } from './DiTing/jobs'
import { cronHistoryRoutes } from './DiTing/cron-history'
import { kanbanRoutes } from './DiTing/kanban'
import { workflowRoutes } from './DiTing/workflows'
import { taskPlanRoutes } from './DiTing/task-plans'
import { subAgentRoutes } from './DiTing/sub-agents'
import { ttsRoutes, ttsProtectedRoutes } from './DiTing/tts'
import { sttProtectedRoutes } from './DiTing/stt'
import { mcuFirmwareRoutes } from './DiTing/mcu-firmware'
import { mediaRoutes } from './DiTing/media'
import { groupChatRoutes, setGroupChatServer } from './DiTing/group-chat'
import { chatRunRoutes } from './DiTing/chat-run'
import { performanceMonitorRoutes } from './DiTing/performance-monitor'
import { mcpRoutes } from './DiTing/mcp'
import { runtimeVersionRoutes } from './DiTing/runtime-versions'
import { writeGateRoutes } from './DiTing/write-gate'

/**
 * Register all routes on the Koa app.
 * Public routes are registered first, then auth middleware,
 * then all protected routes.
 */
export function registerRoutes(app: any, authMiddleware: Array<(ctx: Context, next: Next) => Promise<void>>) {
  // --- Public routes (no auth required) ---
  app.use(healthRoutes.routes())
  app.use(webhookRoutes.routes())
  app.use(authPublicRoutes.routes())
  app.use(devicePublicRoutes.routes())
  app.use(claudeCodeProxyRoutes.routes())
  app.use(codexProxyRoutes.routes())
  app.use(ttsRoutes.routes())
  app.use(apiDocsRoutes.routes())

  // --- Auth middleware: all routes below require authentication ---
  authMiddleware.forEach((middleware) => app.use(middleware))

  // --- Protected routes (auth required) ---
  app.use(authProtectedRoutes.routes())
  app.use(deviceRoutes.routes())
  app.use(uploadRoutes.routes())
  app.use(updateRoutes.routes())           // Must be before proxy (proxy catch-all matches everything)
  app.use(codingAgentRoutes.routes())
  app.use(sessionRoutes.routes())
  app.use(profileRoutes.routes())
  app.use(skillRoutes.routes())
  app.use(pluginRoutes.routes())
  app.use(memoryRoutes.routes())
  app.use(modelRoutes.routes())
  app.use(providerRoutes.routes())
  app.use(configRoutes.routes())
  app.use(logRoutes.routes())
  app.use(codexAuthRoutes.routes())
  app.use(nousAuthRoutes.routes())
  app.use(copilotAuthRoutes.routes())
  app.use(xaiAuthRoutes.routes())
  app.use(anthropicAuthRoutes.routes())
  app.use(geminiAuthRoutes.routes())
  app.use(weixinRoutes.routes())
  app.use(chatRunRoutes.routes())
  app.use(groupChatRoutes.routes())
  app.use(fileRoutes.routes())
  app.use(downloadRoutes.routes())
  app.use(jobRoutes.routes())
  app.use(cronHistoryRoutes.routes())
  app.use(kanbanRoutes.routes())
  app.use(workflowRoutes.routes())
  app.use(taskPlanRoutes.routes())
  app.use(subAgentRoutes.routes())
  app.use(ttsProtectedRoutes.routes())
  app.use(sttProtectedRoutes.routes())
  app.use(mcuFirmwareRoutes.routes())
  app.use(mediaRoutes.routes())
  app.use(performanceMonitorRoutes.routes())
  app.use(mcpRoutes.routes())                   // MCP management
  app.use(runtimeVersionRoutes.routes())         // Runtime and version management
  app.use(writeGateRoutes.routes())              // DiTing Agent write approval review
}
