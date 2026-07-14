import { request } from '../client'

export async function listSubAgentsRegistry<T = Record<string, unknown>>(): Promise<T[]> {
  const res = await request<{ agents: T[] }>('/api/DiTing/sub-agents')
  return Array.isArray(res.agents) ? res.agents : []
}

export async function replaceSubAgentsRegistry<T = Record<string, unknown>>(agents: T[]): Promise<T[]> {
  const res = await request<{ agents: T[] }>('/api/DiTing/sub-agents', {
    method: 'PUT',
    body: JSON.stringify({ agents }),
  })
  return Array.isArray(res.agents) ? res.agents : []
}
