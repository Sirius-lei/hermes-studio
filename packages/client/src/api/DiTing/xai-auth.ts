import { request } from '../client'

export interface XaiStartResult {
  session_id: string
  authorization_url: string
  expires_in: number
}

export interface XaiPollResult {
  status: 'pending' | 'approved' | 'expired' | 'error'
  error: string | null
}

export interface XaiStatusResult {
  authenticated: boolean
  last_refresh?: string
}

export async function startXaiLogin(): Promise<XaiStartResult> {
  return request<XaiStartResult>('/api/DiTing/auth/xai/start', { method: 'POST' })
}

export async function pollXaiLogin(sessionId: string): Promise<XaiPollResult> {
  return request<XaiPollResult>(`/api/DiTing/auth/xai/poll/${sessionId}`)
}

export async function getXaiAuthStatus(): Promise<XaiStatusResult> {
  return request<XaiStatusResult>('/api/DiTing/auth/xai/status')
}
