export type CapabilityKind = 'skill' | 'tool'

export interface CapabilityCatalogRecord {
  id: string
  kind: CapabilityKind
  name: string
  description: string
  category: string
  version?: string
  tags: string[]
  url: string
  entry?: string
  files?: string[]
  path?: string
  sourceProject?: string
  provides?: string[]
  deliveryMode: 'remote_zip' | 'reference'
}

const SKILL_CENTER_KEY = 'hermes.subAgentSkillCenter.v1'
const TOOL_CENTER_KEY = 'hermes.subAgentToolCenter.v1'

const DEFAULT_SKILL_CENTER: CapabilityCatalogRecord[] = [
  {
    id: 'db_query_protocol',
    kind: 'skill',
    name: 'db_query_protocol',
    description: 'MySQL 问数标准协议。先查元数据，再执行只读 SQL，结果优先通过 CSV/cache 交付。',
    category: '问数',
    version: '1.0.0',
    tags: ['mysql', 'query', 'metadata', 'csv', 'cache'],
    url: '',
    path: 'talktome-agent/talktome-agent-deploy/agent/skills/db_query/SKILL.md',
    sourceProject: 'talktome-agent',
    provides: ['metadata_lookup', 'sql_query', 'query_cache_read'],
    deliveryMode: 'reference',
  },
  {
    id: 'csv_result_delivery_protocol',
    kind: 'skill',
    name: 'csv_result_delivery_protocol',
    description: '查询结果交付协议。默认不生成 HTML 报告，优先回传 cache_id、csv_path 和简洁结论。',
    category: '问数',
    version: '1.0.0',
    tags: ['delivery', 'csv', 'report', 'cache'],
    url: '',
    path: 'talktome-agent/talktome-agent-deploy/agent/skills/db_report/SKILL.md',
    sourceProject: 'talktome-agent',
    provides: ['query_cache_read'],
    deliveryMode: 'reference',
  },
]

const DEFAULT_TOOL_CENTER: CapabilityCatalogRecord[] = [
  {
    id: 'talktome-db-query',
    kind: 'tool',
    name: 'talktome-db-query',
    description: '问数工具包，提供 metadata_lookup、sql_query、query_cache_read、generate_report。',
    category: '问数',
    version: '0.1.0',
    tags: ['mysql', 'query', 'report', 'extension'],
    url: '',
    entry: 'index.ts',
    files: ['package.json', 'index.ts', 'README.md'],
    path: 'talktome-agent/talktome-agent-deploy/agent/extensions/talktome-db-query',
    sourceProject: 'talktome-agent',
    provides: ['metadata_lookup', 'sql_query', 'query_cache_read', 'generate_report'],
    deliveryMode: 'reference',
  },
]

function hasWindow() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function storageKey(kind: CapabilityKind) {
  return kind === 'skill' ? SKILL_CENTER_KEY : TOOL_CENTER_KEY
}

function defaultCenter(kind: CapabilityKind) {
  return kind === 'skill' ? DEFAULT_SKILL_CENTER : DEFAULT_TOOL_CENTER
}

function normalizeRecord(kind: CapabilityKind, raw: Partial<CapabilityCatalogRecord>, index: number): CapabilityCatalogRecord {
  return {
    id: String(raw.id || `${kind}-${index + 1}`),
    kind,
    name: String(raw.name || `${kind}-${index + 1}`),
    description: String(raw.description || ''),
    category: String(raw.category || '未分组'),
    version: raw.version ? String(raw.version) : '',
    tags: Array.isArray(raw.tags) ? raw.tags.map(item => String(item || '').trim()).filter(Boolean) : [],
    url: String(raw.url || ''),
    entry: raw.entry ? String(raw.entry) : '',
    files: Array.isArray(raw.files) ? raw.files.map(item => String(item || '').trim()).filter(Boolean) : [],
    path: raw.path ? String(raw.path) : '',
    sourceProject: raw.sourceProject ? String(raw.sourceProject) : '',
    provides: Array.isArray(raw.provides) ? raw.provides.map(item => String(item || '').trim()).filter(Boolean) : [],
    deliveryMode: raw.deliveryMode === 'remote_zip' ? 'remote_zip' : 'reference',
  }
}

export function readCapabilityCenter(kind: CapabilityKind): CapabilityCatalogRecord[] {
  const defaults = defaultCenter(kind)
  if (!hasWindow()) {
    return defaults.map((item, index) => normalizeRecord(kind, item, index))
  }
  try {
    const raw = window.localStorage.getItem(storageKey(kind))
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return defaults.map((item, index) => normalizeRecord(kind, item, index))
    }
    const records = parsed.map((item, index) => normalizeRecord(kind, item || {}, index))
    const existingIds = new Set(records.map(item => item.id))
    for (const item of defaults) {
      if (!existingIds.has(item.id)) {
        records.push(normalizeRecord(kind, item, records.length))
      }
    }
    return records
  } catch {
    return defaults.map((item, index) => normalizeRecord(kind, item, index))
  }
}

export function writeCapabilityCenter(kind: CapabilityKind, records: CapabilityCatalogRecord[]) {
  if (!hasWindow()) return
  window.localStorage.setItem(storageKey(kind), JSON.stringify(records))
}
