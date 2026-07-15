/**
 * Unified initializer for all DiTing SQLite stores.
 * Call this once at bootstrap to create/migrate all tables.
 *
 * All table schemas, creation, and migration logic are now centralized
 * in schemas.ts to avoid duplication and ensure consistency.
 */

import { initAllDiTingTables } from './schemas'

export function initAllStores(): void {
  // Initialize all tables with centralized schema definitions and migrations
  initAllDiTingTables()
}
