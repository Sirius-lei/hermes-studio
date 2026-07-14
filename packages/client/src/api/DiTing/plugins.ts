import { request } from '../client'

export type PluginConfigStatus = 'enabled' | 'disabled' | 'not-enabled' | 'auto' | 'provider-managed'
export type PluginEffectiveStatus = 'enabled' | 'disabled' | 'inactive' | 'auto-active' | 'provider-managed'

export interface DiTingPluginInfo {
  key: string
  name: string
  kind: string
  source: string
  configStatus: PluginConfigStatus | string
  effectiveStatus: PluginEffectiveStatus | string
  version: string
  description: string
  author: string
  path: string
  providesTools: string[]
  providesHooks: string[]
  requiresEnv: Array<string | Record<string, unknown>>
}

export interface DiTingPluginsMetadata {
  DiTingAgentRoot: string
  pythonExecutable: string
  cwd: string
  projectPluginsEnabled: boolean
}

export interface DiTingPluginsResponse {
  plugins: DiTingPluginInfo[]
  warnings: string[]
  metadata: DiTingPluginsMetadata
}

export async function fetchPlugins(): Promise<DiTingPluginsResponse> {
  return request<DiTingPluginsResponse>('/api/DiTing/plugins')
}
