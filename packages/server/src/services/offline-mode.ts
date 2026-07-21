const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on'])

/**
 * Offline deployment disables optional update/catalog/download traffic while
 * keeping explicitly configured model endpoints available for inference.
 */
export function isOfflineMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = String(env.DiTing_OFFLINE || env.DITING_OFFLINE || '').trim().toLowerCase()
  return ENABLED_VALUES.has(value)
}
