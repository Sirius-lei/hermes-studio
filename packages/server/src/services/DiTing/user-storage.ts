import { mkdir } from 'fs/promises'
import { isAbsolute, join, normalize, resolve } from 'path'
import { config } from '../../config'
import { isPathWithin } from './DiTing-path'

function safePathSegment(value: string | number | null | undefined, label: string): string {
  const normalized = String(value == null ? '' : value).trim()
  if (!normalized) {
    throw Object.assign(new Error(`${label} is required`), { code: 'invalid_user_storage_path' })
  }
  if (normalized === '.' || normalized === '..' || normalized.includes('/') || normalized.includes('\\')) {
    throw Object.assign(new Error(`Invalid ${label}`), { code: 'invalid_user_storage_path' })
  }
  const segment = normalized.replace(/[^a-zA-Z0-9._-]+/g, '-')
  if (!segment || segment === '.' || segment === '..') {
    throw Object.assign(new Error(`Invalid ${label}`), { code: 'invalid_user_storage_path' })
  }
  return segment
}

export function getUsersStorageRoot(): string {
  return resolve(config.appHome, 'users')
}

export function getUserStorageRoot(userId: string | number): string {
  return resolve(getUsersStorageRoot(), safePathSegment(userId, 'user_id'))
}

export function getUserFilesDir(userId: string | number, profile = 'default'): string {
  return resolve(getUserStorageRoot(userId), 'files', safePathSegment(profile || 'default', 'profile'))
}

export function resolveUserFilesPath(userId: string | number, profile: string, relativePath = ''): string {
  const root = getUserFilesDir(userId, profile)
  const requested = String(relativePath || '').trim()
  if (!requested || requested === '.') return root
  if (isAbsolute(requested) || requested.replace(/\\/g, '/').split('/').some(segment => segment === '..')) {
    throw Object.assign(new Error('Invalid file path'), { code: 'invalid_path' })
  }
  const resolved = resolve(root, normalize(requested))
  if (!isPathWithin(resolved, root)) {
    throw Object.assign(new Error('Invalid file path'), { code: 'invalid_path' })
  }
  return resolved
}

export function getUserSessionsDir(userId: string | number): string {
  return resolve(getUserStorageRoot(userId), 'sessions')
}

export function getUserSessionDir(userId: string | number, sessionId: string): string {
  return resolve(getUserSessionsDir(userId), safePathSegment(sessionId, 'session_id'))
}

export function getUserSessionWorkspaceDir(userId: string | number, sessionId: string): string {
  return join(getUserSessionDir(userId, sessionId), 'workspace')
}

export async function ensureUserStorage(userId: string | number): Promise<string> {
  const root = getUserStorageRoot(userId)
  await Promise.all([
    mkdir(getUserFilesDir(userId), { recursive: true }),
    mkdir(getUserSessionsDir(userId), { recursive: true }),
  ])
  return root
}

export async function ensureUserFilesDir(userId: string | number, profile = 'default'): Promise<string> {
  const dir = getUserFilesDir(userId, profile)
  await mkdir(dir, { recursive: true })
  return dir
}

export async function ensureUserSessionStorage(userId: string | number, sessionId: string): Promise<string> {
  await ensureUserStorage(userId)
  const workspace = getUserSessionWorkspaceDir(userId, sessionId)
  await mkdir(workspace, { recursive: true })
  return workspace
}

export function isPathInUserStorage(filePath: string, userId: string | number): boolean {
  return isPathWithin(filePath, getUserStorageRoot(userId))
}

export function isPathInUsersStorage(filePath: string): boolean {
  return isPathWithin(filePath, getUsersStorageRoot())
}
