import { describe, expect, it } from 'vitest'
import {
  compareDiTingAgentVersions,
  DiTingAgentVersionFromRuntimeTag,
  runtimeManifestMatchesDiTingAgentVersion,
} from '../../packages/desktop/src/main/runtime-version'

describe('desktop runtime version checks', () => {
  it('derives the DiTing Agent version from the runtime release tag', () => {
    expect(DiTingAgentVersionFromRuntimeTag('DiTing-0.15.2-runtime')).toBe('0.15.2')
    expect(DiTingAgentVersionFromRuntimeTag('latest')).toBeNull()
  })

  it('compares cached runtime manifests to the expected DiTing Agent version', () => {
    expect(runtimeManifestMatchesDiTingAgentVersion({ DiTingAgentVersion: '0.15.2' }, '0.15.2')).toBe(true)
    expect(runtimeManifestMatchesDiTingAgentVersion({ DiTingAgentVersion: '0.15.1' }, '0.15.2')).toBe(false)
    expect(runtimeManifestMatchesDiTingAgentVersion({ asset: { name: 'DiTing-runtime-DiTing-agent-0.15.2-win-x64.tar.gz' } }, '0.15.2')).toBe(true)
    expect(runtimeManifestMatchesDiTingAgentVersion({}, '0.15.2')).toBeNull()
  })

  it('orders DiTing Agent versions numerically', () => {
    expect(compareDiTingAgentVersions('0.16.0', '0.15.2')).toBeGreaterThan(0)
    expect(compareDiTingAgentVersions('0.15.1', '0.15.2')).toBeLessThan(0)
    expect(compareDiTingAgentVersions('0.15.2', '0.15.2')).toBe(0)
  })
})
