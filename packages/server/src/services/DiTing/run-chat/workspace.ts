import { mkdir } from 'fs/promises'
import { join } from 'path'
import { getProfileDir } from '../DiTing-profile'
import { getUserSessionWorkspaceDir } from '../user-storage'

function safePathSegment(value: string | number | null | undefined, fallback: string): string {
  const normalized = String(value == null ? '' : value).trim()
  if (!normalized) return fallback
  return normalized
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback
}

export function defaultDiTingWorkspace(
  profile: string,
  options: {
    userId?: string | number | null
    sessionId?: string | null
  } = {},
): string {
  if (options.userId != null && String(options.userId).trim() && options.sessionId) {
    return getUserSessionWorkspaceDir(options.userId, options.sessionId)
  }
  const base = join(getProfileDir(profile || 'default'), 'workspace')
  if (options.userId == null || !String(options.userId).trim() || !options.sessionId) return base
  const userSegment = safePathSegment(options.userId, 'user')
  const sessionSegment = safePathSegment(options.sessionId, 'session')
  return join(base, 'users', userSegment, 'sessions', sessionSegment)
}

export async function ensureDiTingRunWorkspace(
  profile: string,
  workspace?: string | null,
  options: {
    userId?: string | number | null
    sessionId?: string | null
    allowCustomWorkspace?: boolean
  } = {},
): Promise<string> {
  const requested = String(workspace || '').trim()
  const resolved = options.userId != null && options.sessionId && !options.allowCustomWorkspace
    ? defaultDiTingWorkspace(profile, options)
    : requested || defaultDiTingWorkspace(profile, options)
  await mkdir(resolved, { recursive: true })
  return resolved
}
