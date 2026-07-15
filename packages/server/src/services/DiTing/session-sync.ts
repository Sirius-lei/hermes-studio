/**
 * DiTing session import is intentionally disabled.
 *
 * DiTing state.db remains a read-only source for DiTing-specific history APIs.
 * The web-ui local sessions/messages tables must not be populated from DiTing
 * on startup, because that can mix ownership and make data-loss incidents much
 * harder to reason about.
 */
import { logger } from '../logger'

export async function syncAllDiTingSessionsOnStartup(): Promise<void> {
  logger.info('[session-sync] DiTing session import is disabled')
}
