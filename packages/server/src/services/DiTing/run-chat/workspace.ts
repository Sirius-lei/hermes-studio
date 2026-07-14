import { mkdir } from 'fs/promises'
import { join } from 'path'
import { getProfileDir } from '../DiTing-profile'

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
  const base = join(getProfileDir(profile || 'default'), 'workspace')
  if (!options.sessionId) return base
  const userSegment = safePathSegment(options.userId, 'anonymous')
  const sessionSegment = safePathSegment(options.sessionId, 'session')
  return join(base, 'users', userSegment, 'sessions', sessionSegment)
}

export async function ensureDiTingRunWorkspace(
  profile: string,
  workspace?: string | null,
  options: {
    userId?: string | number | null
    sessionId?: string | null
  } = {},
): Promise<string> {
  const resolved = String(workspace || '').trim() || defaultDiTingWorkspace(profile, options)
  await mkdir(resolved, { recursive: true })
  return resolved
}
