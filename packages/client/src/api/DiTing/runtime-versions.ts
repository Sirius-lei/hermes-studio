import { request } from '@/api/client'

export interface ActiveVersionManifest {
  schema: number
  DiTingRuntimeVersion?: string
  webUiVersion?: string
  runtimeDirectory?: string
  webUiDirectory?: string
  platform?: string
  updatedAt?: string
}

export interface InstalledRuntimeVersion {
  version: string
  platform: string
  directory: string
  active: boolean
  manifestDiTingRuntimeVersion?: string
}

export interface InstalledWebUiVersion {
  version: string
  directory: string
  active: boolean
}

export type VersionDownloadKind = 'runtime' | 'webui'
export type VersionDownloadSource = 'cf' | 'github'
export type VersionDownloadJobStatus = 'queued' | 'running' | 'completed' | 'failed'
export type VersionDownloadStage = 'queued' | 'resolve' | 'download' | 'verify' | 'extract' | 'install' | 'completed' | 'failed'

export interface VersionDownloadJob {
  id: string
  kind: VersionDownloadKind
  source: VersionDownloadSource
  version: string
  status: VersionDownloadJobStatus
  stage: VersionDownloadStage
  message: string
  error: string
  percent?: number
  receivedBytes?: number
  totalBytes?: number
  createdAt: string
  updatedAt: string
  result?: InstalledRuntimeVersion | InstalledWebUiVersion
}

export interface RuntimeVersionStatus {
  active: ActiveVersionManifest | null
  platform: string
  activeVersionPath: string
  remoteManifestUrl: string
  remoteError: string
  DiTing: {
    activeVersion: string
    activeDirectory: string
    installed: InstalledRuntimeVersion[]
    remoteVersions: string[]
  }
  webui: {
    currentVersion: string
    activeVersion: string
    activeDirectory: string
    installed: InstalledWebUiVersion[]
    remoteVersions: string[]
  }
}

export async function fetchRuntimeVersionStatus(): Promise<RuntimeVersionStatus> {
  return request<RuntimeVersionStatus>('/api/DiTing/runtime-versions')
}

export async function activateRuntimeVersion(version: string): Promise<{ success: boolean; active: ActiveVersionManifest }> {
  return request<{ success: boolean; active: ActiveVersionManifest }>('/api/DiTing/runtime-versions/active-runtime', {
    method: 'POST',
    body: JSON.stringify({ version }),
  })
}

export async function activateWebUiVersion(version: string): Promise<{ success: boolean; active: ActiveVersionManifest }> {
  return request<{ success: boolean; active: ActiveVersionManifest }>('/api/DiTing/runtime-versions/active-webui', {
    method: 'POST',
    body: JSON.stringify({ version }),
  })
}

export async function downloadRuntimeVersion(version: string, source: VersionDownloadSource): Promise<{ success: boolean; job: VersionDownloadJob }> {
  return request<{ success: boolean; job: VersionDownloadJob }>('/api/DiTing/runtime-versions/runtime/download', {
    method: 'POST',
    body: JSON.stringify({ version, source }),
  })
}

export async function deleteRuntimeVersion(version: string): Promise<{ success: boolean; deleted: InstalledRuntimeVersion }> {
  return request<{ success: boolean; deleted: InstalledRuntimeVersion }>(`/api/DiTing/runtime-versions/runtime/${encodeURIComponent(version)}`, {
    method: 'DELETE',
  })
}

export async function downloadWebUiVersion(version: string, source: VersionDownloadSource): Promise<{ success: boolean; job: VersionDownloadJob }> {
  return request<{ success: boolean; job: VersionDownloadJob }>('/api/DiTing/runtime-versions/webui/download', {
    method: 'POST',
    body: JSON.stringify({ version, source }),
  })
}

export async function deleteWebUiVersion(version: string): Promise<{ success: boolean; deleted: InstalledWebUiVersion }> {
  return request<{ success: boolean; deleted: InstalledWebUiVersion }>(`/api/DiTing/runtime-versions/webui/${encodeURIComponent(version)}`, {
    method: 'DELETE',
  })
}

export async function fetchVersionDownloadJobs(): Promise<{ jobs: VersionDownloadJob[] }> {
  return request<{ jobs: VersionDownloadJob[] }>('/api/DiTing/runtime-versions/jobs')
}

export async function fetchVersionDownloadJob(id: string): Promise<VersionDownloadJob> {
  return request<VersionDownloadJob>(`/api/DiTing/runtime-versions/jobs/${encodeURIComponent(id)}`)
}
