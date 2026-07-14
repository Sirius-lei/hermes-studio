import { existsSync, readFileSync } from 'fs'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const agentBridgeMocks = vi.hoisted(() => ({
  destroyAll: vi.fn(),
  destroyProfile: vi.fn(),
}))

const skillInjectorMocks = vi.hoisted(() => ({
  injectMissingSkills: vi.fn(),
  resolveTargetDirForProfile: vi.fn(),
}))

const sessionDeleterMocks = vi.hoisted(() => ({
  switchProfile: vi.fn(),
}))

const gatewayAutostartMocks = vi.hoisted(() => ({
  getGatewayRuntimeStatusForProfile: vi.fn(),
  prepareGatewayForProfileDelete: vi.fn(),
  restartGatewayForProfile: vi.fn(),
}))

// Mock DiTing-cli
vi.mock('../../packages/server/src/services/DiTing/DiTing-cli', () => ({
  listProfiles: vi.fn(),
  getProfile: vi.fn(),
  createProfile: vi.fn(),
  deleteProfile: vi.fn(),
  renameProfile: vi.fn(),
  useProfile: vi.fn(),
  stopGateway: vi.fn(),
  startGateway: vi.fn(),
  startGatewayBackground: vi.fn(),
  setupReset: vi.fn(),
  exportProfile: vi.fn(),
  importProfile: vi.fn(),
}))

vi.mock('../../packages/server/src/services/DiTing/agent-bridge', () => ({
  AgentBridgeClient: vi.fn(() => ({
    destroyAll: agentBridgeMocks.destroyAll,
    destroyProfile: agentBridgeMocks.destroyProfile,
  })),
}))

vi.mock('../../packages/server/src/services/DiTing/skill-injector', () => {
  const DiTingSkillInjector = vi.fn(() => ({
    injectMissingSkills: skillInjectorMocks.injectMissingSkills,
  })) as any
  DiTingSkillInjector.resolveTargetDirForProfile = skillInjectorMocks.resolveTargetDirForProfile
  return { DiTingSkillInjector }
})

vi.mock('../../packages/server/src/services/DiTing/session-deleter', () => ({
  SessionDeleter: {
    getInstance: vi.fn(() => sessionDeleterMocks),
  },
}))

vi.mock('../../packages/server/src/services/DiTing/gateway-autostart', () => ({
  getGatewayRuntimeStatusForProfile: gatewayAutostartMocks.getGatewayRuntimeStatusForProfile,
  prepareGatewayForProfileDelete: gatewayAutostartMocks.prepareGatewayForProfileDelete,
  restartGatewayForProfile: gatewayAutostartMocks.restartGatewayForProfile,
}))

import * as DiTingCli from '../../packages/server/src/services/DiTing/DiTing-cli'

describe('Profile Routes', () => {
  const originalDiTingHome = process.env.DiTing_HOME
  const originalWebUiHome = process.env.DiTing_WEB_UI_HOME
  const tempHomes: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    agentBridgeMocks.destroyProfile.mockResolvedValue({ destroyed: 0 })
    gatewayAutostartMocks.prepareGatewayForProfileDelete.mockResolvedValue(undefined)
    skillInjectorMocks.injectMissingSkills.mockResolvedValue({ targets: [] })
    skillInjectorMocks.resolveTargetDirForProfile.mockImplementation((name: string) => join('/tmp/DiTing-skills', name))
  })

  afterEach(async () => {
    if (originalDiTingHome === undefined) delete process.env.DiTing_HOME
    else process.env.DiTing_HOME = originalDiTingHome
    if (originalWebUiHome === undefined) delete process.env.DiTing_WEB_UI_HOME
    else process.env.DiTing_WEB_UI_HOME = originalWebUiHome
    await Promise.all(tempHomes.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  describe('DiTing-cli wrapper', () => {
    it('listProfiles returns array', async () => {
      const mockProfiles = [{ name: 'default', active: true }]
      vi.mocked(DiTingCli.listProfiles).mockResolvedValue(mockProfiles as any)

      const result = await DiTingCli.listProfiles()
      expect(result).toEqual(mockProfiles)
    })

    it('getProfile returns profile detail', async () => {
      const mockDetail = { name: 'default', path: '/tmp/default' }
      vi.mocked(DiTingCli.getProfile).mockResolvedValue(mockDetail as any)

      const result = await DiTingCli.getProfile('default')
      expect(result).toEqual(mockDetail)
      expect(DiTingCli.getProfile).toHaveBeenCalledWith('default')
    })

    it('createProfile calls CLI with name and clone flag', async () => {
      vi.mocked(DiTingCli.createProfile).mockResolvedValue('Profile created')

      await DiTingCli.createProfile('test', true)

      expect(DiTingCli.createProfile).toHaveBeenCalledWith('test', true)
    })

    it('clone creation copies only the configured model provider auth for the new profile', async () => {
      const DiTingHome = await mkdtemp(join(tmpdir(), 'DiTing-profile-clone-auth-'))
      tempHomes.push(DiTingHome)
      process.env.DiTing_HOME = DiTingHome
      await writeFile(join(DiTingHome, 'active_profile'), 'default\n', 'utf-8')
      await writeFile(join(DiTingHome, 'auth.json'), JSON.stringify({
        providers: {
          'openai-codex': { access_token: 'codex-provider-token' },
          anthropic: { access_token: 'anthropic-provider-token' },
        },
        credential_pool: {
          'openai-codex': [{ access_token: 'codex-pool-token' }],
          anthropic: [{ access_token: 'anthropic-pool-token' }],
        },
      }, null, 2), 'utf-8')
      vi.mocked(DiTingCli.createProfile).mockImplementation(async (name: string) => {
        const profileDir = join(DiTingHome, 'profiles', name)
        await mkdir(profileDir, { recursive: true })
        await writeFile(join(profileDir, 'config.yaml'), [
          'model:',
          '  provider: openai-codex',
          '  default: gpt-5.5',
          '',
        ].join('\n'), 'utf-8')
        return 'Profile created'
      })
      const { create } = await import('../../packages/server/src/controllers/DiTing/profiles')
      const ctx: any = {
        request: { body: { name: 'cloned', clone: true } },
        status: 200,
        body: undefined,
      }

      await create(ctx)

      expect(ctx.status).toBe(200)
      expect(ctx.body.copiedAuthProviders).toEqual(['openai-codex'])
      const clonedAuth = JSON.parse(readFileSync(join(DiTingHome, 'profiles', 'cloned', 'auth.json'), 'utf-8'))
      expect(clonedAuth.providers['openai-codex']).toEqual({ access_token: 'codex-provider-token' })
      expect(clonedAuth.credential_pool['openai-codex']).toEqual([{ access_token: 'codex-pool-token' }])
      expect(clonedAuth.providers.anthropic).toBeUndefined()
      expect(clonedAuth.credential_pool.anthropic).toBeUndefined()
    })

    it('deleteProfile calls CLI with name', async () => {
      vi.mocked(DiTingCli.deleteProfile).mockResolvedValue(true)

      await DiTingCli.deleteProfile('test')

      expect(DiTingCli.deleteProfile).toHaveBeenCalledWith('test')
    })

    it('renameProfile calls CLI with old and new name', async () => {
      vi.mocked(DiTingCli.renameProfile).mockResolvedValue(true)

      await DiTingCli.renameProfile('old', 'new')

      expect(DiTingCli.renameProfile).toHaveBeenCalledWith('old', 'new')
    })
  })

  describe('profile rename validation', () => {
    it('rejects reserved profile names before calling DiTing CLI', async () => {
      vi.mocked(DiTingCli.renameProfile).mockResolvedValue(true)
      const { rename } = await import('../../packages/server/src/controllers/DiTing/profiles')
      const ctx: any = {
        params: { name: 'work' },
        request: { body: { new_name: 'DiTing' } },
        status: 200,
        body: undefined,
      }

      await rename(ctx)

      expect(ctx.status).toBe(400)
      expect(ctx.body).toEqual({ error: "Profile name 'DiTing' is reserved and cannot be used" })
      expect(DiTingCli.renameProfile).not.toHaveBeenCalled()
    })
  })

  describe('profile deletion fallback', () => {
    it('prepares the profile gateway for deletion before calling DiTing CLI delete', async () => {
      const DiTingHome = await mkdtemp(join(tmpdir(), 'DiTing-profile-delete-'))
      tempHomes.push(DiTingHome)
      process.env.DiTing_HOME = DiTingHome
      const profileDir = join(DiTingHome, 'profiles', 'work')
      await mkdir(profileDir, { recursive: true })
      await writeFile(join(profileDir, 'config.yaml'), 'model:\n  default: test\n', 'utf-8')

      gatewayAutostartMocks.prepareGatewayForProfileDelete.mockImplementation(async () => {
        await rm(profileDir, { recursive: true, force: true })
      })
      vi.mocked(DiTingCli.deleteProfile).mockResolvedValue(true)
      const { remove } = await import('../../packages/server/src/controllers/DiTing/profiles')
      const ctx: any = { params: { name: 'work' }, status: 200, body: undefined }

      await remove(ctx)

      expect(gatewayAutostartMocks.prepareGatewayForProfileDelete).toHaveBeenCalledWith('work')
      expect(DiTingCli.deleteProfile).toHaveBeenCalledWith('work')
      expect(ctx.status).toBe(200)
      expect(ctx.body).toEqual({ success: true })
    })

    it('does not return success when DiTing CLI reports delete success but the profile directory remains', async () => {
      const DiTingHome = await mkdtemp(join(tmpdir(), 'DiTing-profile-delete-'))
      tempHomes.push(DiTingHome)
      process.env.DiTing_HOME = DiTingHome
      const profileDir = join(DiTingHome, 'profiles', 'work')
      await mkdir(profileDir, { recursive: true })
      await writeFile(join(profileDir, 'config.yaml'), 'model:\n  default: test\n', 'utf-8')
      vi.mocked(DiTingCli.deleteProfile).mockResolvedValue(true)
      const { remove } = await import('../../packages/server/src/controllers/DiTing/profiles')
      const ctx: any = { params: { name: 'work' }, status: 200, body: undefined }

      await remove(ctx)

      expect(ctx.status).toBe(500)
      expect(ctx.body).toEqual({ error: 'Failed to delete profile: profile directory still exists' })
      expect(existsSync(profileDir)).toBe(true)
    })

    it('removes a reserved profile directory when DiTing CLI refuses to delete it', async () => {
      const DiTingHome = await mkdtemp(join(tmpdir(), 'DiTing-profile-delete-'))
      tempHomes.push(DiTingHome)
      process.env.DiTing_HOME = DiTingHome
      const badProfileDir = join(DiTingHome, 'profiles', 'DiTing')
      await mkdir(badProfileDir, { recursive: true })
      await writeFile(join(badProfileDir, 'config.yaml'), 'model:\n  default: bad\n', 'utf-8')
      await writeFile(join(DiTingHome, 'active_profile'), 'DiTing\n', 'utf-8')
      vi.mocked(DiTingCli.deleteProfile).mockResolvedValue(false)
      const { remove } = await import('../../packages/server/src/controllers/DiTing/profiles')
      const ctx: any = { params: { name: 'DiTing' }, status: 200, body: undefined }

      await remove(ctx)

      expect(ctx.status).toBe(200)
      expect(ctx.body).toEqual({ success: true, fallback: 'removed_reserved_profile_from_disk' })
      expect(existsSync(badProfileDir)).toBe(false)
      expect(readFileSync(join(DiTingHome, 'active_profile'), 'utf-8')).toBe('default\n')
    })

    it('does not bypass DiTing CLI failures for normal profile names', async () => {
      const DiTingHome = await mkdtemp(join(tmpdir(), 'DiTing-profile-delete-'))
      tempHomes.push(DiTingHome)
      process.env.DiTing_HOME = DiTingHome
      const profileDir = join(DiTingHome, 'profiles', 'work')
      await mkdir(profileDir, { recursive: true })
      vi.mocked(DiTingCli.deleteProfile).mockResolvedValue(false)
      const { remove } = await import('../../packages/server/src/controllers/DiTing/profiles')
      const ctx: any = { params: { name: 'work' }, status: 200, body: undefined }

      await remove(ctx)

      expect(ctx.status).toBe(500)
      expect(ctx.body).toEqual({ error: 'Failed to delete profile' })
      expect(existsSync(profileDir)).toBe(true)
    })
  })

  describe('DiTing CLI active profile switch', () => {
    it('only destroys bridge sessions for the target profile', async () => {
      const DiTingHome = await mkdtemp(join(tmpdir(), 'DiTing-profile-switch-'))
      tempHomes.push(DiTingHome)
      process.env.DiTing_HOME = DiTingHome
      const profileDir = join(DiTingHome, 'profiles', 'work')
      await mkdir(profileDir, { recursive: true })
      await writeFile(join(profileDir, 'config.yaml'), 'model:\n  default: gpt-test\n', 'utf-8')
      await writeFile(join(DiTingHome, 'active_profile'), 'work\n', 'utf-8')
      vi.mocked(DiTingCli.useProfile).mockResolvedValue('Switched to work')
      vi.mocked(DiTingCli.getProfile).mockResolvedValue({
        name: 'work',
        path: profileDir,
        model: 'gpt-test',
        provider: 'test',
        skills: 0,
        hasEnv: false,
        hasSoulMd: false,
      } as any)
      agentBridgeMocks.destroyProfile.mockResolvedValue({ destroyed: 2 })
      const { switchProfile } = await import('../../packages/server/src/controllers/DiTing/profiles')
      const ctx: any = {
        request: { body: { name: 'work' } },
        status: 200,
        body: undefined,
      }

      await switchProfile(ctx)

      expect(ctx.status).toBe(200)
      expect(ctx.body).toMatchObject({ success: true, active: 'work' })
      expect(agentBridgeMocks.destroyProfile).toHaveBeenCalledWith('work')
      expect(agentBridgeMocks.destroyAll).not.toHaveBeenCalled()
      expect(sessionDeleterMocks.switchProfile).toHaveBeenCalledWith('work')
    })
  })

  describe('profile avatars', () => {
    it('stores generated avatar metadata under the Web UI home', async () => {
      const webUiHome = await mkdtemp(join(tmpdir(), 'DiTing-web-ui-avatar-'))
      tempHomes.push(webUiHome)
      process.env.DiTing_WEB_UI_HOME = webUiHome
      const { updateAvatar } = await import('../../packages/server/src/controllers/DiTing/profiles')
      const ctx: any = {
        params: { name: 'work' },
        request: { body: { type: 'generated', seed: 'custom-seed' } },
        status: 200,
        body: undefined,
      }

      await updateAvatar(ctx)

      const metaPath = join(webUiHome, 'profile-metadata', Buffer.from('work', 'utf-8').toString('base64url'), 'avatar.json')
      expect(ctx.status).toBe(200)
      expect(ctx.body.avatar).toMatchObject({ type: 'generated', seed: 'custom-seed' })
      expect(JSON.parse(readFileSync(metaPath, 'utf-8'))).toMatchObject({
        type: 'generated',
        seed: 'custom-seed',
      })
    })

    it('stores uploaded image avatars and returns a data URL', async () => {
      const webUiHome = await mkdtemp(join(tmpdir(), 'DiTing-web-ui-avatar-'))
      tempHomes.push(webUiHome)
      process.env.DiTing_WEB_UI_HOME = webUiHome
      const dataUrl = `data:image/png;base64,${Buffer.from('avatar-png').toString('base64')}`
      const { updateAvatar } = await import('../../packages/server/src/controllers/DiTing/profiles')
      const ctx: any = {
        params: { name: 'work' },
        request: { body: { type: 'image', dataUrl } },
        status: 200,
        body: undefined,
      }

      await updateAvatar(ctx)

      const dir = join(webUiHome, 'profile-metadata', Buffer.from('work', 'utf-8').toString('base64url'))
      const meta = JSON.parse(readFileSync(join(dir, 'avatar.json'), 'utf-8'))
      expect(ctx.status).toBe(200)
      expect(ctx.body.avatar).toMatchObject({ type: 'image', dataUrl })
      expect(meta).toMatchObject({ type: 'image', file: 'avatar.bin', mime: 'image/png' })
      expect(readFileSync(join(dir, 'avatar.bin')).toString()).toBe('avatar-png')
    })

    it('deletes profile avatar metadata', async () => {
      const webUiHome = await mkdtemp(join(tmpdir(), 'DiTing-web-ui-avatar-'))
      tempHomes.push(webUiHome)
      process.env.DiTing_WEB_UI_HOME = webUiHome
      const metadataDir = join(webUiHome, 'profile-metadata', Buffer.from('work', 'utf-8').toString('base64url'))
      await mkdir(metadataDir, { recursive: true })
      await writeFile(join(metadataDir, 'avatar.json'), '{"type":"generated"}\n', 'utf-8')
      const { deleteAvatar } = await import('../../packages/server/src/controllers/DiTing/profiles')
      const ctx: any = { params: { name: 'work' }, status: 200, body: undefined }

      await deleteAvatar(ctx)

      expect(ctx.status).toBe(200)
      expect(ctx.body).toEqual({ success: true })
      expect(existsSync(metadataDir)).toBe(false)
    })
  })
})
