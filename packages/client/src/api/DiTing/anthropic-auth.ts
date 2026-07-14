import { request } from '../client'

export interface AnthropicStartResult {
  session_id: string
  authorization_url: string
  expires_in: number
}

export interface AnthropicSubmitResult {
  status: 'approved' | 'expired' | 'error'
  error: string | null
}

export interface AnthropicStatusResult {
  authenticated: boolean
  last_refresh?: string
}

export async function startAnthropicLogin(): Promise<AnthropicStartResult> {
  return request<AnthropicStartResult>('/api/DiTing/auth/anthropic/start', { method: 'POST' })
}

export async function submitAnthropicLogin(sessionId: string, code: string): Promise<AnthropicSubmitResult> {
  return request<AnthropicSubmitResult>(`/api/DiTing/auth/anthropic/submit/${sessionId}`, {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export async function getAnthropicAuthStatus(): Promise<AnthropicStatusResult> {
  return request<AnthropicStatusResult>('/api/DiTing/auth/anthropic/status')
}
