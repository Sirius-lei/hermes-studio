import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const { mockGatewayAutostartDisabledByEnv, mockRestartGatewayForProfile } = vi.hoisted(() => ({
  mockGatewayAutostartDisabledByEnv: vi.fn(() => false),
  mockRestartGatewayForProfile: vi.fn().mockResolvedValue({ running: true, profile: 'research' }),
}))

vi.mock('../../packages/server/src/services/DiTing/gateway-autostart', () => ({
  gatewayAutostartDisabledByEnv: mockGatewayAutostartDisabledByEnv,
  restartGatewayForProfile: mockRestartGatewayForProfile,
}))

let DiTingHome = ''
const originalDiTingHome = process.env.DiTing_HOME
const originalWebUiHome = process.env.DiTing_WEB_UI_HOME

async function loadController() {
  vi.resetModules()
  process.env.DiTing_HOME = DiTingHome
  process.env.DiTing_WEB_UI_HOME = DiTingHome
  return import('../../packages/server/src/controllers/DiTing/weixin')
}

function makeCtx(body: Record<string, any>, profile = 'research'): any {
  return {
    request: { body },
    state: { profile: { name: profile } },
    status: 200,
    body: undefined,
  }
}

describe('weixin controller', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockGatewayAutostartDisabledByEnv.mockReturnValue(false)
    DiTingHome = await mkdtemp(join(tmpdir(), 'hwui-weixin-controller-'))
    await mkdir(join(DiTingHome, 'profiles', 'research'), { recursive: true })
    await writeFile(join(DiTingHome, '.env'), [
      'WEIXIN_ACCOUNT_ID=keep-default-account',
      'WEIXIN_TOKEN=keep-default-token',
      '',
    ].join('\n'), 'utf-8')
    await writeFile(join(DiTingHome, 'profiles', 'research', '.env'), [
      'OPENROUTER_API_KEY=keep-research-openrouter',
      'WEIXIN_ACCOUNT_ID=old-research-account',
      'WEIXIN_TOKEN=old-research-token',
      '',
    ].join('\n'), 'utf-8')
  })

  afterEach(async () => {
    vi.resetModules()
    if (originalDiTingHome === undefined) delete process.env.DiTing_HOME
    else process.env.DiTing_HOME = originalDiTingHome
    if (originalWebUiHome === undefined) delete process.env.DiTing_WEB_UI_HOME
    else process.env.DiTing_WEB_UI_HOME = originalWebUiHome
    if (DiTingHome) await rm(DiTingHome, { recursive: true, force: true })
    DiTingHome = ''
  })

  it('saves scanned Weixin credentials to the request-scoped profile env only', async () => {
    const { save } = await loadController()
    const ctx = makeCtx({
      account_id: 'new-research-account',
      token: 'new-research-token',
      base_url: 'https://weixin.invalid',
    })

    await save(ctx)

    expect(ctx.body).toEqual({ success: true })
    expect(mockRestartGatewayForProfile).toHaveBeenCalledWith('research')
    expect(await readFile(join(DiTingHome, '.env'), 'utf-8')).toContain('WEIXIN_TOKEN=keep-default-token')
    const researchEnv = await readFile(join(DiTingHome, 'profiles', 'research', '.env'), 'utf-8')
    expect(researchEnv).toContain('OPENROUTER_API_KEY=keep-research-openrouter')
    expect(researchEnv).toContain('WEIXIN_ACCOUNT_ID=new-research-account')
    expect(researchEnv).toContain('WEIXIN_TOKEN=new-research-token')
    expect(researchEnv).toContain('WEIXIN_BASE_URL=https://weixin.invalid')
  })

  it('rejects missing required credentials without touching the profile env', async () => {
    const { save } = await loadController()
    const ctx = makeCtx({ account_id: 'new-research-account' })
    const envBefore = await readFile(join(DiTingHome, 'profiles', 'research', '.env'), 'utf-8')

    await save(ctx)

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({ error: 'Missing account_id or token' })
    expect(mockRestartGatewayForProfile).not.toHaveBeenCalled()
    await expect(readFile(join(DiTingHome, 'profiles', 'research', '.env'), 'utf-8')).resolves.toBe(envBefore)
  })

  it('saves scanned Weixin credentials without restarting when gateway auto-start is disabled', async () => {
    await writeFile(join(DiTingHome, 'config.json'), JSON.stringify({
      gatewayAutoStart: { enabled: false },
    }), 'utf-8')
    const { save } = await loadController()
    const ctx = makeCtx({
      account_id: 'new-research-account',
      token: 'new-research-token',
    })

    await save(ctx)

    expect(ctx.body).toEqual({ success: true })
    expect(mockRestartGatewayForProfile).not.toHaveBeenCalled()
    const researchEnv = await readFile(join(DiTingHome, 'profiles', 'research', '.env'), 'utf-8')
    expect(researchEnv).toContain('WEIXIN_ACCOUNT_ID=new-research-account')
    expect(researchEnv).toContain('WEIXIN_TOKEN=new-research-token')
  })
})
