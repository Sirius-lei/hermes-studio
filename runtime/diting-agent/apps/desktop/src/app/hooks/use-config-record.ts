import { useQuery } from '@tanstack/react-query'

import { getDiTingConfigRecord } from '@/diting'
import { queryClient, writeCache } from '@/lib/query-client'
import type { DiTingConfigRecord } from '@/types/diting'

// One shared cache for the whole profile config record (`GET /api/config`).
// Every settings surface (MCP, model, config) reads and writes through this key
// so a save in one shows in the others, and revisiting a tab paints the cache
// instead of blanking on a fresh fetch.
//
// Distinct from session/hooks/use-diting-config.ts, which is side-effecting —
// it pushes personality/cwd/voice/… into the session stores for live chat.
export const DiTing_CONFIG_KEY = ['diting-config-record'] as const

// staleTime 0 → serve cache instantly, background-revalidate on every mount.
export const useDiTingConfigRecord = () =>
  useQuery({ queryKey: DiTing_CONFIG_KEY, queryFn: getDiTingConfigRecord, staleTime: 0 })

export const setDiTingConfigCache = writeCache<DiTingConfigRecord>(DiTing_CONFIG_KEY)

export const invalidateDiTingConfig = () => queryClient.invalidateQueries({ queryKey: DiTing_CONFIG_KEY })
