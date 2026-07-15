import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import YAML from 'js-yaml'

vi.mock('../../packages/server/src/services/DiTing/DiTing-cli', () => ({
  restartGateway: vi.fn().mockResolvedValue(undefined),
}))

let DiTingHome = ''

async function loadProvidersController() {
  vi.resetModules()
  process.env.DiTing_HOME = DiTingHome
  return import('../../packages/server/src/controllers/DiTing/providers')
}

function makeCtx(poolKey: string, body: Record<string, any>, profile = 'research') {
  return {
    params: { poolKey: encodeURIComponent(poolKey) },
    request: { body },
    state: { profile: { name: profile } },
    status: 200,
    body: undefined as unknown,
  }
}

function readYaml(filePath: string) {
  return YAML.load(readFileSync(filePath, 'utf-8')) as any
}

describe('providers controller update', () => {
  beforeEach(() => {
    DiTingHome = mkdtempSync(join(tmpdir(), 'hwui-provider-update-'))
    mkdirSync(join(DiTingHome, 'profiles', 'research'), { recursive: true })
    writeFileSync(join(DiTingHome, 'config.yaml'), 'model:\n  provider: deepseek\n  default: keep-default-model\n')
    writeFileSync(join(DiTingHome, '.env'), [
      'DEEPSEEK_API_KEY=keep-default-key',
      '',
    ].join('\n'))
    writeFileSync(join(DiTingHome, 'profiles', 'research', 'config.yaml'), [
      'model:',
      '  provider: custom:research-proxy',
      '  default: research-model',
      'custom_providers:',
      '  - name: research-proxy',
      '    base_url: https://research.invalid/v1',
      '    api_key: old-research-custom-key',
      '    model: research-model',
      '',
    ].join('\n'))
    writeFileSync(join(DiTingHome, 'profiles', 'research', '.env'), [
      'DEEPSEEK_API_KEY=old-research-key',
      '',
    ].join('\n'))
  })

  afterEach(() => {
    delete process.env.DiTing_HOME
    vi.doUnmock('../../packages/server/src/controllers/DiTing/providers')
    vi.clearAllMocks()
    if (DiTingHome) rmSync(DiTingHome, { recursive: true, force: true })
    DiTingHome = ''
  })

  it('updates built-in provider API keys in the request-scoped profile env only', async () => {
    const { update } = await loadProvidersController()
    const ctx = makeCtx('deepseek', { api_key: 'new-research-key' })

    await update(ctx)

    expect(ctx.body).toEqual({ success: true })
    expect(readFileSync(join(DiTingHome, '.env'), 'utf-8')).toContain('DEEPSEEK_API_KEY=keep-default-key')
    expect(readFileSync(join(DiTingHome, 'profiles', 'research', '.env'), 'utf-8')).toContain('DEEPSEEK_API_KEY=new-research-key')
  })

  it('updates custom provider API keys in the request-scoped profile config only', async () => {
    const defaultConfigPath = join(DiTingHome, 'config.yaml')
    writeFileSync(defaultConfigPath, [
      'model:',
      '  provider: custom:research-proxy',
      '  default: default-model',
      'custom_providers:',
      '  - name: research-proxy',
      '    base_url: https://default.invalid/v1',
      '    api_key: keep-default-custom-key',
      '    model: default-model',
      '',
    ].join('\n'))

    const { update } = await loadProvidersController()
    const ctx = makeCtx('custom:research-proxy', { api_key: 'new-research-custom-key' })

    await update(ctx)

    expect(ctx.body).toEqual({ success: true })
    const defaultConfig = readYaml(defaultConfigPath)
    const researchConfig = readYaml(join(DiTingHome, 'profiles', 'research', 'config.yaml'))
    expect(defaultConfig.custom_providers[0].api_key).toBe('keep-default-custom-key')
    expect(researchConfig.custom_providers[0].api_key).toBe('new-research-custom-key')
  })

  it('updates custom provider api_mode in the request-scoped profile config only', async () => {
    const defaultConfigPath = join(DiTingHome, 'config.yaml')
    writeFileSync(defaultConfigPath, [
      'model:',
      '  provider: custom:research-proxy',
      '  default: default-model',
      'custom_providers:',
      '  - name: research-proxy',
      '    base_url: https://default.invalid/v1',
      '    api_key: keep-default-custom-key',
      '    model: default-model',
      '    api_mode: codex_responses',
      '',
    ].join('\n'))

    const { update } = await loadProvidersController()
    const ctx = makeCtx('custom:research-proxy', { api_mode: 'chat_completions' })

    await update(ctx)

    expect(ctx.body).toEqual({ success: true })
    const defaultConfig = readYaml(defaultConfigPath)
    const researchConfig = readYaml(join(DiTingHome, 'profiles', 'research', 'config.yaml'))
    expect(defaultConfig.custom_providers[0].api_mode).toBe('codex_responses')
    expect(researchConfig.custom_providers[0].api_mode).toBe('chat_completions')
  })
})
