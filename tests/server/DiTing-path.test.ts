import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectDiTingHome } from '../../packages/server/src/services/DiTing/DiTing-path'

describe('DiTing path detection', () => {
  const originalEnv = { ...process.env }
  const originalPlatform = process.platform
  let tempDir = ''

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'DiTing-path-'))
    process.env = { ...originalEnv }
    delete process.env.DiTing_HOME
    delete process.env.LOCALAPPDATA
    delete process.env.APPDATA
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    process.env = { ...originalEnv }
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
    tempDir = ''
  })

  it('keeps explicit DiTing_HOME even when the path does not exist', () => {
    process.env.DiTing_HOME = join(tempDir, 'custom-home')

    expect(detectDiTingHome()).toBe(resolve(tempDir, 'custom-home'))
  })

  it('falls back to ~/.DiTing on Windows when LOCALAPPDATA DiTing is missing', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    process.env.LOCALAPPDATA = join(tempDir, 'Local')

    expect(detectDiTingHome()).toBe(resolve(homedir(), '.DiTing'))
  })

  it('uses existing Windows LOCALAPPDATA DiTing before APPDATA', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const localDiTing = join(tempDir, 'Local', 'DiTing')
    const roamingDiTing = join(tempDir, 'Roaming', 'DiTing')
    mkdirSync(localDiTing, { recursive: true })
    mkdirSync(roamingDiTing, { recursive: true })
    process.env.LOCALAPPDATA = join(tempDir, 'Local')
    process.env.APPDATA = join(tempDir, 'Roaming')

    expect(detectDiTingHome()).toBe(resolve(localDiTing))
  })

  it('falls back to existing Windows APPDATA DiTing when LOCALAPPDATA DiTing is missing', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const roamingDiTing = join(tempDir, 'Roaming', 'DiTing')
    mkdirSync(roamingDiTing, { recursive: true })
    process.env.LOCALAPPDATA = join(tempDir, 'Local')
    process.env.APPDATA = join(tempDir, 'Roaming')

    expect(detectDiTingHome()).toBe(resolve(roamingDiTing))
  })
})
