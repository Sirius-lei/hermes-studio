import { join, resolve } from 'path'
import { homedir } from 'os'

/**
 * Web UI environment variables.
 *
 * Server/listen:
 * - PORT: Web UI listen port. Default: 18648.
 * - BIND_HOST: Web UI bind host. Default: 0.0.0.0.
 * - CORS_ORIGINS: Comma/space-separated cross-origin allowlist. Default: same host only.
 *
 * Web UI storage:
 * - DiTing_WEB_UI_HOME: Web UI data home for auth token, credentials, logs, DB, and default uploads.
 * - DiTing_WEBUI_STATE_DIR: Compatibility alias for DiTing_WEB_UI_HOME.
 *   Default: join(homedir(), '.diting-web-ui').
 * - UPLOAD_DIR: Upload directory override. Default: join(DiTing_WEB_UI_HOME, 'upload').
 * - dataDir: Development-only internal Web UI runtime data directory.
 *
 * Auth:
 * - AUTH_TOKEN: Explicit bearer token. If unset, Web UI stores an auto-generated token under DiTing_WEB_UI_HOME.
 *
 * Runtime behavior:
 * - PROFILE: Initial DiTing profile name. Default: default.
 * - DiTing_GATEWAY_URL / GATEWAY_URL: Explicit DiTing gateway upstream URL for proxy routes.
 * - GATEWAY_HOST: Default DiTing gateway upstream host. Default: 127.0.0.1.
 * - GATEWAY_PORT: Default DiTing gateway upstream port. Default: 18642.
 * - DiTing_WEB_UI_DISABLE_GATEWAY_AUTOSTART: Disable Web UI gateway autostart checks and config-driven gateway start/stop reconciliation.
 * - DiTing_WEB_UI_MANAGED_GATEWAY: Web UI-managed DiTing gateway handling. Enabled by default; set 0/false/off to use CLI start.
 * - DiTing_WEB_UI_STOP_GATEWAYS_ON_SHUTDOWN: Whether Web UI shutdown also stops managed gateways.
 * - DiTing_WEB_UI_DISABLE_MCP_AUTOINJECT: Disable DiTing Studio MCP config injection.
 * - DiTing_WEB_UI_ALLOW_TRANSIENT_MCP_AUTOINJECT: Allow MCP injection when DiTing_WEB_UI_HOME is under a temp dir.
 * - DiTing_LAN_DISCOVERY_ENABLED: Set false/0/off to disable UDP LAN discovery responder.
 * - DiTing_LAN_DISCOVERY_HTTP_PORTS: HTTP ports to probe during UDP discovery scans. Default: 18648,8748 plus current PORT.
 *   Discovery probes are sent to the fixed UDP port 48640 plus legacy mapped ports for compatibility.
 * - WORKSPACE_BASE: Base directory for workspace browsing. Default: current user's home directory.
 *
 * Limits/logging:
 * - MAX_DOWNLOAD_SIZE: Max file download size. Default: 200MB.
 * - MAX_EDIT_SIZE: Max editable file size. Default: 10MB.
 * - LOG_LEVEL: Server log level. Default: info.
 * - BRIDGE_LOG_LEVEL: Bridge log level. Default: LOG_LEVEL or info.
 */

export function getListenHost(env: Record<string, string | undefined> = process.env): string {
  const host = env.BIND_HOST?.trim()
  return host || '0.0.0.0'
}

export function getWebUiHome(env: Record<string, string | undefined> = process.env): string {
  const appHome = env.DiTing_WEB_UI_HOME?.trim() || env.DiTing_WEBUI_STATE_DIR?.trim()
  return appHome ? resolve(appHome) : join(homedir(), '.diting-web-ui')
}

export function shouldCreateWebUiDataDir(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== 'production'
}

export function getCorsOrigins(env: Record<string, string | undefined> = process.env): string {
  return env.CORS_ORIGINS?.trim() || ''
}

const appHome = getWebUiHome()

export const config = {
  port: parseInt(process.env.PORT || '18648', 10),
  // Default to IPv4 for stable WSL/Windows browser access. Use BIND_HOST=:: explicitly for IPv6.
  host: getListenHost(),
  appHome,
  uploadDir: process.env.UPLOAD_DIR || join(appHome, 'upload'),
  dataDir: resolve(__dirname, '..', 'data'),
  corsOrigins: getCorsOrigins(),
}
