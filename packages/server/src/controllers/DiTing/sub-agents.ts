import type { Context } from 'koa'
import { listUserProfiles } from '../../db/DiTing/users-store'
import { listOrDiscoverSubAgentsRegistry, replaceSubAgentsRegistry } from '../../db/DiTing/sub-agent-store'

const DEFAULT_PROFILE = 'default'
const MAX_SUB_AGENTS = 200

function bodyRecord(ctx: Context): Record<string, unknown> {
  const body = ctx.request.body
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function profileName(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_PROFILE
}

function requestedProfile(ctx: Context, body?: Record<string, unknown>): string {
  const stateProfile = ctx.state?.profile?.name || ''
  const bodyProfile = body && typeof body.profile === 'string' ? body.profile.trim() : ''
  const queryProfile = firstQueryValue(ctx.query.profile as string | string[] | undefined)?.trim() || ''
  return profileName(stateProfile || bodyProfile || queryProfile)
}

function allowedProfileSet(ctx: Context): Set<string> | null {
  const user = ctx.state?.user
  if (!user || user.role === 'super_admin') return null
  return new Set(listUserProfiles(user.id).map(profile => profile.profile_name))
}

function denyProfileAccess(ctx: Context, profile: string | null | undefined): boolean {
  const allowed = allowedProfileSet(ctx)
  const normalizedProfile = profileName(profile)
  if (!allowed || allowed.has(normalizedProfile)) return false
  ctx.status = 403
  ctx.body = { error: `Profile "${normalizedProfile}" is not available for this user` }
  return true
}

function normalizeAgentPayloads(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null
  return value
    .slice(0, MAX_SUB_AGENTS)
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .map(item => item as Record<string, unknown>)
}

export async function list(ctx: Context) {
  const profile = requestedProfile(ctx)
  if (denyProfileAccess(ctx, profile)) return
  ctx.body = {
    agents: await listOrDiscoverSubAgentsRegistry(profile),
  }
}

export async function replace(ctx: Context) {
  const body = bodyRecord(ctx)
  const profile = requestedProfile(ctx, body)
  if (denyProfileAccess(ctx, profile)) return

  const agents = normalizeAgentPayloads(body.agents)
  if (!agents) {
    ctx.status = 400
    ctx.body = { error: 'agents must be an array' }
    return
  }

  ctx.body = {
    agents: replaceSubAgentsRegistry(profile, agents),
  }
}
