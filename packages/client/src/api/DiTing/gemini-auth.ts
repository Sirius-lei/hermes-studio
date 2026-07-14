import { request } from '../client'

export interface GeminiStartResult {
  session_id: string
  authorization_url: string
  expires_in: number
}

export interface GeminiPollResult {
  status: 'pending' | 'approved' | 'expired' | 'error'
  error: string | null
}

export interface GeminiStatusResult {
  authenticated: boolean
  email?: string
  expires_at_ms?: number
}

export async function startGeminiLogin(): Promise<GeminiStartResult> {
  return request<GeminiStartResult>('/api/DiTing/auth/gemini/start', { method: 'POST' })
}

export async function pollGeminiLogin(sessionId: string): Promise<GeminiPollResult> {
  return request<GeminiPollResult>(`/api/DiTing/auth/gemini/poll/${sessionId}`)
}

export async function getGeminiAuthStatus(): Promise<GeminiStatusResult> {
  return request<GeminiStatusResult>('/api/DiTing/auth/gemini/status')
}
