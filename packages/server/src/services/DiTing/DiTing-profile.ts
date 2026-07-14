import { join } from 'path'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { detectDiTingRootHome } from './DiTing-path'

export function getDiTingBaseDir(): string {
  return detectDiTingRootHome()
}

/**
 * Get the active profile's home directory.
 * default → ~/.DiTing/
 * other   → ~/.DiTing/profiles/{name}/
 */
export function getActiveProfileDir(): string {
  const DiTingBase = getDiTingBaseDir()
  const activeFile = join(DiTingBase, 'active_profile')
  try {
    const name = readFileSync(activeFile, 'utf-8').trim()
    if (name && name !== 'default') {
      const dir = join(DiTingBase, 'profiles', name)
      if (existsSync(dir)) return dir
    }
  } catch { }
  return DiTingBase
}

/**
 * Get the active profile's config.yaml path.
 */
export function getActiveConfigPath(): string {
  return join(getActiveProfileDir(), 'config.yaml')
}

/**
 * Get the active profile's auth.json path.
 */
export function getActiveAuthPath(): string {
  return join(getActiveProfileDir(), 'auth.json')
}

/**
 * Get the active profile's .env path.
 */
export function getActiveEnvPath(): string {
  return join(getActiveProfileDir(), '.env')
}

/**
 * Get the active profile name.
 */
export function getActiveProfileName(): string {
  const activeFile = join(getDiTingBaseDir(), 'active_profile')
  try {
    const name = readFileSync(activeFile, 'utf-8').trim()
    return name || 'default'
  } catch {
    return 'default'
  }
}

/**
 * Get profile directory by name.
 * default → ~/.DiTing/
 * other   → ~/.DiTing/profiles/{name}/
 */
export function getProfileDir(name: string): string {
  const DiTingBase = getDiTingBaseDir()
  if (!name || name === 'default') return DiTingBase
  const dir = join(DiTingBase, 'profiles', name)
  return existsSync(dir) ? dir : DiTingBase
}

export function listProfileNamesFromDisk(): string[] {
  const DiTingBase = getDiTingBaseDir()
  const names = new Set<string>(['default'])
  const profilesDir = join(DiTingBase, 'profiles')
  try {
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.trim()) {
        names.add(entry.name)
      }
    }
  } catch {}
  return [...names].sort((a, b) => {
    if (a === 'default') return -1
    if (b === 'default') return 1
    return a.localeCompare(b)
  })
}
