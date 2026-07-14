import { request } from '../client'

export interface CollaborationRunRecord {
  id: string
  session_id: string
  run_id: string | null
  user_id: string | null
  profile: string
  status: 'running' | 'completed' | 'failed'
  mode: string
  intent: string
  category: string
  reason: string
  text: string
  objective: string
  selected_agent_id: string
  selected_agent_name: string
  current_node_id: string | null
  route_json: Record<string, unknown>
  snapshot_json: Record<string, unknown>
  events_json: Array<Record<string, unknown>>
  error: string | null
  started_at: number
  ended_at: number | null
  updated_at: number
}

export async function fetchSessionCollaborationRuns(sessionId: string, limit = 50): Promise<CollaborationRunRecord[]> {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  const res = await request<{ runs: CollaborationRunRecord[] }>(
    `/api/DiTing/sessions/${encodeURIComponent(sessionId)}/collaboration-runs?${params.toString()}`,
  )
  return Array.isArray(res.runs) ? res.runs : []
}

export async function fetchCollaborationRun(runId: string): Promise<CollaborationRunRecord | null> {
  try {
    const res = await request<{ run: CollaborationRunRecord }>(`/api/DiTing/collaboration-runs/${encodeURIComponent(runId)}`)
    return res.run || null
  } catch {
    return null
  }
}

export async function fetchCollaborationRunEvents(runId: string): Promise<Array<Record<string, unknown>>> {
  try {
    const res = await request<{ events: Array<Record<string, unknown>> }>(
      `/api/DiTing/collaboration-runs/${encodeURIComponent(runId)}/events`,
    )
    return Array.isArray(res.events) ? res.events : []
  } catch {
    return []
  }
}
