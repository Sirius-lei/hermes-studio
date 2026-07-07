import { getDb, jsonDelete, jsonGetAll, jsonSet } from '../index'
import { SUB_AGENTS_REGISTRY_TABLE } from './schemas'

export interface SubAgentRegistryRecord {
  profile: string
  id: string
  payload_json: Record<string, unknown>
  created_at: number
  updated_at: number
}

interface SubAgentRegistryRow {
  profile: string
  id: string
  payload_json: string
  created_at: number
  updated_at: number
}

interface RuntimeAgentProfileResponse {
  id?: string
  name?: string
  description?: string
  agents_md?: {
    content?: string
  }
  model_summary?: Array<{
    name?: string
    baseUrl?: string
    api?: string
    hasApiKey?: boolean
    models?: Array<{ id?: string; name?: string }>
  }>
  packages?: string[]
  skills?: Array<{
    name?: string
    description?: string
    version?: string
    path?: string
    tags?: string[]
  }>
  extensions?: Array<{
    name?: string
    description?: string
    version?: string
    path?: string
    entry?: string
    files?: string[]
  }>
}

const DEFAULT_RUNTIME_TIMEOUT_MS = 2500
const DEFAULT_SUBAGENT_RUNTIME_URLS = [
  'http://127.0.0.1:8767',
  'http://172.16.50.149:8768',
]

function profileName(value?: string | null): string {
  return value?.trim() || 'default'
}

function jsonKey(profile: string, id: string): string {
  return `${profileName(profile)}:${id.trim()}`
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function configuredBootstrapRuntimeUrls(): string[] {
  const envValue = String(process.env.HERMES_SUBAGENT_RUNTIME_URLS || '').trim()
  const envUrls = envValue
    ? envValue.split(',').map(item => item.trim()).filter(Boolean)
    : []
  return [...envUrls, ...DEFAULT_SUBAGENT_RUNTIME_URLS]
    .map(item => item.replace(/\/+$/, ''))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
}

function summarizeModelSummary(summary: RuntimeAgentProfileResponse['model_summary']): string {
  if (!Array.isArray(summary) || summary.length === 0) return '未返回模型摘要'
  return summary.map((item) => {
    const models = Array.isArray(item.models)
      ? item.models.map(model => model?.name || model?.id || '').filter(Boolean).slice(0, 3).join(', ')
      : ''
    return [item.name || '', models, item.baseUrl ? `@ ${item.baseUrl}` : '']
      .filter(Boolean)
      .join(' ')
  }).filter(Boolean).join('；') || '未返回模型摘要'
}

function hasConfiguredApiKey(summary: RuntimeAgentProfileResponse['model_summary']): boolean {
  return Array.isArray(summary) && summary.some(item => item?.hasApiKey === true)
}

function runtimeAssetList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const raw = item && typeof item === 'object' && !Array.isArray(item)
      ? item as Record<string, unknown>
      : {}
    return {
      name: String(raw.name || raw.id || raw.path || '').trim(),
      description: String(raw.description || raw.path || raw.entry || '').trim(),
      version: String(raw.version || '').trim(),
      path: String(raw.path || '').trim(),
      entry: String(raw.entry || '').trim(),
      files: Array.isArray(raw.files) ? raw.files : [],
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      source: 'runtime',
    }
  }).filter(item => String(item.name || '').trim())
}

async function fetchRuntimeProfile(baseUrl: string): Promise<RuntimeAgentProfileResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_RUNTIME_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseUrl}/api/agent/profile`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    })
    if (!response.ok) {
      throw new Error(`runtime profile returned ${response.status}`)
    }
    return await response.json() as RuntimeAgentProfileResponse
  } finally {
    clearTimeout(timer)
  }
}

function buildDiscoveredRuntimeAgent(baseUrl: string, profile: RuntimeAgentProfileResponse): Record<string, unknown> {
  const now = Date.now()
  return {
    id: String(profile.id || profile.name || 'pi-mono').trim(),
    name: String(profile.name || profile.id || 'pi-mono').trim(),
    description: String(profile.description || '使用 subAgent-pi 运行时提供的子智能体。').trim(),
    baseUrl,
    status: 'online',
    agentsMd: String(profile.agents_md?.content || '').trim(),
    skills: runtimeAssetList(profile.skills),
    tools: runtimeAssetList(profile.extensions),
    packages: Array.isArray(profile.packages) ? profile.packages : [],
    callCount: 0,
    successRate: 0,
    avgLatencyMs: 0,
    modelSummary: summarizeModelSummary(profile.model_summary),
    lastRun: '自动发现运行时配置',
    lastPublishedAt: null,
    deployments: [],
    recentInvocations: [],
    runtimeConfig: {
      source: 'subAgent-pi runtime',
      configPath: 'GET /api/agent/profile',
      configSection: 'runtime APIs',
      enabled: true,
      chatPath: '/v1/chat/completions',
      timeoutSeconds: 600,
      apiKeyConfigured: hasConfiguredApiKey(profile.model_summary),
      templateProject: 'subAgent-pi',
      managementEndpoints: [],
      lastSyncedAt: now,
      syncError: '',
    },
    updatedAt: now,
  }
}

function normalizePayload(
  value: unknown,
  index: number,
  fallbackCreatedAt?: number,
): { id: string; payload: Record<string, unknown>; createdAt: number; updatedAt: number } {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const now = Date.now()
  const id = String(raw.id || raw.name || `sub-agent-${index + 1}`).trim()
  const name = String(raw.name || raw.id || id || `Sub Agent ${index + 1}`).trim()
  const payload = {
    ...raw,
    id,
    name,
    updatedAt: Number(raw.updatedAt || raw.updated_at || now) || now,
  }
  return {
    id,
    payload,
    createdAt: Number(raw.created_at || fallbackCreatedAt || now) || now,
    updatedAt: now,
  }
}

function rowToRecord(row: SubAgentRegistryRow | Record<string, unknown>): SubAgentRegistryRecord {
  const raw = row as Record<string, unknown>
  return {
    profile: profileName(String(raw.profile || 'default')),
    id: String(raw.id || ''),
    payload_json: parsePayload(raw.payload_json),
    created_at: Number(raw.created_at || 0),
    updated_at: Number(raw.updated_at || 0),
  }
}

function listExistingByProfile(profile: string): Map<string, SubAgentRegistryRecord> {
  return new Map(listSubAgentRegistryRows(profile).map(record => [record.id, record]))
}

export function listSubAgentRegistryRows(profile?: string | null): SubAgentRegistryRecord[] {
  const normalizedProfile = profileName(profile)
  const db = getDb()
  if (!db) {
    return Object.values(jsonGetAll(SUB_AGENTS_REGISTRY_TABLE))
      .map(rowToRecord)
      .filter(record => record.profile === normalizedProfile)
      .sort((a, b) => b.updated_at - a.updated_at)
  }

  const rows = db.prepare(
    `SELECT * FROM ${SUB_AGENTS_REGISTRY_TABLE} WHERE profile = ? ORDER BY updated_at DESC`
  ).all(normalizedProfile) as unknown as SubAgentRegistryRow[]
  return rows.map(rowToRecord)
}

export function listSubAgentsRegistry<T = Record<string, unknown>>(profile?: string | null): T[] {
  return listSubAgentRegistryRows(profile).map(record => ({
    ...record.payload_json,
    id: record.id,
  })) as unknown as T[]
}

export async function listOrDiscoverSubAgentsRegistry<T = Record<string, unknown>>(profile?: string | null): Promise<T[]> {
  const existing = listSubAgentsRegistry<T>(profile)
  if (existing.length > 0) return existing

  const discovered: Record<string, unknown>[] = []
  for (const baseUrl of configuredBootstrapRuntimeUrls()) {
    try {
      const profileResponse = await fetchRuntimeProfile(baseUrl)
      const record = buildDiscoveredRuntimeAgent(baseUrl, profileResponse)
      if (String(record.id || '').trim()) {
        discovered.push(record)
      }
    } catch {
      // continue probing next known runtime
    }
  }

  if (discovered.length === 0) return []
  return replaceSubAgentsRegistry(profile, discovered as T[])
}

export function replaceSubAgentsRegistry<T = Record<string, unknown>>(
  profile: string | null | undefined,
  records: T[],
): T[] {
  const normalizedProfile = profileName(profile)
  const existingById = listExistingByProfile(normalizedProfile)
  const normalizedRecords = records
    .map((record, index) => normalizePayload(record, index, existingById.get(String((record as any)?.id || '').trim())?.created_at))
    .filter(record => record.id)

  const db = getDb()
  if (!db) {
    const existingKeys = Object.values(jsonGetAll(SUB_AGENTS_REGISTRY_TABLE))
      .map(rowToRecord)
      .filter(record => record.profile === normalizedProfile)
      .map(record => jsonKey(record.profile, record.id))

    for (const key of existingKeys) jsonDelete(SUB_AGENTS_REGISTRY_TABLE, key)
    for (const record of normalizedRecords) {
      jsonSet(SUB_AGENTS_REGISTRY_TABLE, jsonKey(normalizedProfile, record.id), {
        profile: normalizedProfile,
        id: record.id,
        payload_json: record.payload,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      })
    }
    return normalizedRecords.map(record => record.payload as T)
  }

  const insert = db.prepare(`
    INSERT INTO ${SUB_AGENTS_REGISTRY_TABLE} (
      profile, id, payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
  `)
  const clear = db.prepare(`DELETE FROM ${SUB_AGENTS_REGISTRY_TABLE} WHERE profile = ?`)
  db.exec('BEGIN')
  try {
    clear.run(normalizedProfile)
    for (const record of normalizedRecords) {
      insert.run(
        normalizedProfile,
        record.id,
        JSON.stringify(record.payload),
        record.createdAt,
        record.updatedAt,
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return normalizedRecords.map(record => record.payload as unknown as T)
}
