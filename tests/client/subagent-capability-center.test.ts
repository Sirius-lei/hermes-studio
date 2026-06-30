import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readCapabilityCenter,
  writeCapabilityCenter,
} from '../../packages/client/src/utils/subagent-capability-center'

describe('subagent capability center', () => {
  beforeEach(() => {
    if (typeof window === 'undefined') {
      const store: Record<string, string> = {}
      ;(globalThis as any).window = {
        localStorage: {
          getItem: vi.fn((key: string) => store[key] ?? null),
          setItem: vi.fn((key: string, value: string) => { store[key] = value }),
          removeItem: vi.fn((key: string) => { delete store[key] }),
          clear: vi.fn(() => { for (const key of Object.keys(store)) delete store[key] }),
        },
      }
    }
    window.localStorage.clear()
    vi.clearAllMocks()
  })

  it('seeds ask-data skills and tools by default', () => {
    const skills = readCapabilityCenter('skill')
    const tools = readCapabilityCenter('tool')

    expect(skills.map(item => item.id)).toEqual(expect.arrayContaining([
      'db_query_protocol',
      'csv_result_delivery_protocol',
    ]))
    expect(tools.map(item => item.id)).toEqual(expect.arrayContaining([
      'talktome-db-query',
    ]))
  })

  it('keeps default seed records after custom records are written', () => {
    writeCapabilityCenter('skill', [{
      id: 'custom-skill',
      kind: 'skill',
      name: 'custom-skill',
      description: 'custom',
      category: '通用',
      version: '1.0.0',
      tags: ['custom'],
      url: 'https://example.com/custom-skill.zip',
      entry: '',
      files: [],
      path: '',
      sourceProject: 'subAgent-pi',
      provides: ['custom_run'],
      deliveryMode: 'remote_zip',
    }])

    const skills = readCapabilityCenter('skill')
    expect(skills.map(item => item.id)).toEqual(expect.arrayContaining([
      'custom-skill',
      'db_query_protocol',
      'csv_result_delivery_protocol',
    ]))
  })
})
