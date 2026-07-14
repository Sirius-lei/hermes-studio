export interface SessionAccessUserLike {
  id?: string | number | null
  role?: string | null
}

export interface SessionOwnedRecordLike {
  user_id?: string | number | null
}

function normalizeId(value: string | number | null | undefined): string {
  return String(value == null ? '' : value).trim()
}

export function isSuperAdminUser(user?: SessionAccessUserLike | null): boolean {
  return String(user?.role || '').trim() === 'super_admin'
}

export function canAccessOwnedRecord(
  user: SessionAccessUserLike | null | undefined,
  record: SessionOwnedRecordLike | null | undefined,
): boolean {
  if (!user) return true
  if (!record) return true
  if (isSuperAdminUser(user)) return true
  const ownerId = normalizeId(record.user_id)
  if (!ownerId) return false
  return ownerId === normalizeId(user.id)
}

export function currentUserId(user: SessionAccessUserLike | null | undefined): string | null {
  const normalized = normalizeId(user?.id)
  return normalized || null
}

export function effectiveRequestedUserId(
  user: SessionAccessUserLike | null | undefined,
  requestedUserId: string | number | null | undefined,
): string | null {
  const requested = normalizeId(requestedUserId)
  if (!requested) return null
  if (!user) return requested
  if (isSuperAdminUser(user)) return requested
  const current = normalizeId(user.id)
  return current && current === requested ? requested : null
}

export function effectiveSessionOwnerId(
  user: SessionAccessUserLike | null | undefined,
  requestedUserId: string | number | null | undefined,
): string | null {
  return effectiveRequestedUserId(user, requestedUserId) || currentUserId(user)
}

export function canAccessOwnedRecordWithContext(
  user: SessionAccessUserLike | null | undefined,
  record: SessionOwnedRecordLike | null | undefined,
  requestedUserId: string | number | null | undefined,
): boolean {
  const requested = effectiveRequestedUserId(user, requestedUserId)
  if (!requested) return canAccessOwnedRecord(user, record)
  if (!record) return true
  const ownerId = normalizeId(record.user_id)
  return !!ownerId && ownerId === requested
}
