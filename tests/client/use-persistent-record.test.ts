// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { usePersistentRecord } from '@/composables/usePersistentRecord'

describe('usePersistentRecord', () => {
  beforeEach(() => localStorage.clear())

  it('loads saved record and persists updates', () => {
    localStorage.setItem('DiTing.sidebar.collapsedGroups', JSON.stringify({ agent: true }))
    const state = usePersistentRecord('DiTing.sidebar.collapsedGroups')

    expect(state.record.agent).toBe(true)
    state.record.system = true
    state.persist()

    expect(JSON.parse(localStorage.getItem('DiTing.sidebar.collapsedGroups') || '{}')).toEqual({
      agent: true,
      system: true,
    })
  })

  it('ignores invalid stored values', () => {
    localStorage.setItem('DiTing.sidebar.collapsedGroups', 'not-json')
    const state = usePersistentRecord('DiTing.sidebar.collapsedGroups')

    expect({ ...state.record }).toEqual({})
  })
})
