import router from '@/router'

const DEFAULT_BASE_URL = ''
const ACTIVE_PROFILE_STORAGE_KEY = 'DiTing_active_profile_name'
const ACTIVE_USER_CONTEXT_STORAGE_KEY = 'DiTing_active_user_context'

function isDesktopShell(): boolean {
  return typeof window !== 'undefined' &&
    (window as typeof window & { DiTingDesktop?: { isDesktop?: boolean } }).DiTingDesktop?.isDesktop === true
}

function getBaseUrl(): string {
  if (import.meta.env.VITE_DiTing_PREVIEW === '1') return DEFAULT_BASE_URL
  if (isDesktopShell()) return DEFAULT_BASE_URL
  return localStorage.getItem('DiTing_server_url') || DEFAULT_BASE_URL
}

export function getApiKey(): string {
  return localStorage.getItem('DiTing_api_key') || ''
}

export function setServerUrl(url: string) {
  localStorage.setItem('DiTing_server_url', url)
}

export function setApiKey(key: string) {
  localStorage.setItem('DiTing_api_key', key)
}

export function clearApiKey() {
  localStorage.removeItem('DiTing_api_key')
}

function clearAuthSessionState() {
  clearApiKey()
  localStorage.removeItem(ACTIVE_PROFILE_STORAGE_KEY)
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(ACTIVE_USER_CONTEXT_STORAGE_KEY)
  }
}

export function hasApiKey(): boolean {
  return !!getApiKey()
}

export type StoredUserRole = 'super_admin' | 'admin'

export function getStoredUserRole(): StoredUserRole | null {
  const token = getApiKey()
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const data = JSON.parse(atob(padded)) as { role?: unknown }
    return data.role === 'super_admin' || data.role === 'admin' ? data.role : null
  } catch {
    return null
  }
}

export function isStoredSuperAdmin(): boolean {
  return getStoredUserRole() === 'super_admin'
}

export function getStoredUsername(): string | null {
  const token = getApiKey()
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const data = JSON.parse(atob(padded)) as { username?: unknown }
    return typeof data.username === 'string' && data.username.length > 0 ? data.username : null
  } catch {
    return null
  }
}

export function getActiveProfileName(): string | null {
  return localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY)
}

export function setActiveUserContextId(userId: string | null | undefined) {
  if (typeof window === 'undefined') return
  const normalized = String(userId || '').trim()
  if (normalized) {
    window.sessionStorage.setItem(ACTIVE_USER_CONTEXT_STORAGE_KEY, normalized)
    return
  }
  window.sessionStorage.removeItem(ACTIVE_USER_CONTEXT_STORAGE_KEY)
}

export function getActiveUserContextId(): string | null {
  if (typeof window === 'undefined') return null
  const normalized = String(window.sessionStorage.getItem(ACTIVE_USER_CONTEXT_STORAGE_KEY) || '').trim()
  return normalized || null
}

function bodyHasProfileSelector(body: BodyInit | null | undefined): boolean {
  if (typeof body !== 'string') return false
  try {
    const parsed = JSON.parse(body) as { profile?: unknown }
    return typeof parsed?.profile === 'string' && parsed.profile.trim().length > 0
  } catch {
    return false
  }
}

function shouldAttachProfileHeader(path: string, options: RequestInit): boolean {
  try {
    const url = new URL(path, 'http://DiTing.local')
    if (url.searchParams.has('profile')) return false
    if (url.pathname.startsWith('/api/DiTing/profiles')) return false
    if (isProfileWideSessionCollection(url.pathname)) return false
  } catch {
    if (path.startsWith('/api/DiTing/profiles')) return false
    if (isProfileWideSessionCollection(path.split('?')[0] || path)) return false
  }
  return !bodyHasProfileSelector(options.body)
}

function isProfileWideSessionCollection(pathname: string): boolean {
  return pathname === '/api/DiTing/sessions' ||
    pathname === '/api/DiTing/sessions/batch-delete' ||
    pathname === '/api/DiTing/search/sessions' ||
    pathname === '/api/DiTing/sessions/search' ||
    pathname === '/api/DiTing/sessions/conversations'
}

function emitAuthNotice(kind: 'expired' | 'forbidden') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('DiTing-auth-notice', { detail: { kind } }))
}

function messageFromErrorValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (typeof value !== 'object') return String(value)

  const record = value as Record<string, unknown>
  for (const key of ['message', 'error', 'detail', 'description']) {
    const message = messageFromErrorValue(record[key])
    if (message) return message
  }

  if (Array.isArray(value)) {
    return value.map(messageFromErrorValue).filter(Boolean).join('\n')
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function responseErrorMessage(text: string, statusText: string): string {
  const trimmed = text.trim()
  if (!trimmed) return statusText
  try {
    const parsed = JSON.parse(trimmed)
    return messageFromErrorValue(parsed) || trimmed
  } catch {
    return trimmed
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const base = getBaseUrl()
  const url = `${base}${path}`
  const isFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData
  const headers: Record<string, string> = {
    ...(isFormDataBody ? {} : { 'Content-Type': 'application/json' }),
    ...options.headers as Record<string, string>,
  }

  const apiKey = getApiKey()
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  // Inject active profile header for request-scoped endpoints. Explicit profile
  // selectors in the URL/body and profile-name routes are validated directly.
  const profileName = getActiveProfileName()
  if (profileName && shouldAttachProfileHeader(path, options)) {
    headers['X-DiTing-Profile'] = profileName
  }

  const userContextId = getActiveUserContextId()
  if (userContextId && path.startsWith('/api/DiTing/')) {
    headers['X-DiTing-User-Context'] = userContextId
  }

  const res = await fetch(url, { ...options, headers })

  // Global 401 handler — only redirect to login for local BFF endpoints
  // Proxied gateway requests should not trigger logout
  const isLocalBff = !path.startsWith('/api/DiTing/v1/') &&
    !path.startsWith('/v1/')

  if (res.status === 401 && isLocalBff) {
    clearAuthSessionState()
    emitAuthNotice('expired')
    if (router.currentRoute.value.name !== 'login') {
      router.replace({ name: 'login' })
    }
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 403 && isLocalBff) {
      if (text.includes('User is disabled or does not exist')) {
        clearAuthSessionState()
        emitAuthNotice('expired')
        if (router.currentRoute.value.name !== 'login') {
          router.replace({ name: 'login' })
        }
      } else {
        emitAuthNotice('forbidden')
      }
    }
    throw new Error(`API Error ${res.status}: ${responseErrorMessage(text, res.statusText)}`)
  }

  return res.json()
}

export function getBaseUrlValue(): string {
  return getBaseUrl()
}
