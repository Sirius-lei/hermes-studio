import { resolve } from 'path'
import { isPathWithin } from './DiTing-path'
import { getUserFilesDir } from './user-storage'

function safeProfileSegment(profile: string): string {
  const name = (profile || 'default').trim() || 'default'
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw Object.assign(new Error('Invalid profile name'), { code: 'invalid_profile' })
  }
  return name
}

export function getProfileUploadDir(profile: string, userId: string | number): string {
  return resolve(getUserFilesDir(userId, safeProfileSegment(profile)))
}

export function isInProfileUploadDir(filePath: string, profile: string, userId: string | number): boolean {
  return isPathWithin(filePath, getProfileUploadDir(profile, userId))
}
