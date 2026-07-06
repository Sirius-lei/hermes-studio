import { AgentBridgeClient } from './client'
import { getActiveProfileName } from '../hermes-profile'
import { logger } from '../../logger'

function envPositiveInt(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function isDisabledToken(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized === '0'
    || normalized === 'false'
    || normalized === 'off'
    || normalized === 'no'
    || normalized === 'none'
    || normalized === 'disabled'
}

export function resolveWarmProfiles(
  raw = process.env.HERMES_AGENT_BRIDGE_WARM_PROFILES,
  activeProfile = getActiveProfileName(),
): string[] {
  const source = String(raw ?? '').trim()
  if (!source) return [activeProfile || 'default']
  if (isDisabledToken(source)) return []

  const profiles: string[] = []
  const seen = new Set<string>()
  for (const token of source.split(/[,\s]+/)) {
    const normalized = token.trim()
    if (!normalized) continue
    const profile = normalized === 'active'
      ? (activeProfile || 'default')
      : normalized
    if (!profile || seen.has(profile)) continue
    seen.add(profile)
    profiles.push(profile)
  }
  return profiles
}

export async function warmAgentBridgeProfilesOnStartup(endpoint?: string): Promise<string[]> {
  const profiles = resolveWarmProfiles()
  if (profiles.length === 0) return []

  const client = new AgentBridgeClient({
    endpoint,
    timeoutMs: envPositiveInt('HERMES_AGENT_BRIDGE_WARM_TIMEOUT_MS') ?? 30000,
    connectRetryMs: 0,
  })

  const warmed: string[] = []
  for (const profile of profiles) {
    try {
      await client.warmProfile(profile)
      warmed.push(profile)
    } catch (err) {
      logger.warn(err, '[agent-bridge] failed to warm profile worker profile=%s', profile)
    }
  }
  return warmed
}
