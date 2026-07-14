import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const tempDirs: string[] = []
const originalDiTingHome = process.env.DiTing_HOME
const originalSkillsDir = process.env.DiTing_WEB_UI_SKILLS_DIR

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function readManifest(skillsDir: string) {
  return JSON.parse(await readFile(join(skillsDir, '.webui-managed-skills.json'), 'utf-8'))
}

afterEach(async () => {
  vi.resetModules()
  if (originalDiTingHome === undefined) delete process.env.DiTing_HOME
  else process.env.DiTing_HOME = originalDiTingHome
  if (originalSkillsDir === undefined) delete process.env.DiTing_WEB_UI_SKILLS_DIR
  else process.env.DiTing_WEB_UI_SKILLS_DIR = originalSkillsDir
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('DiTingSkillInjector', () => {
  it('resolves source directories for override, production bundle, and development layouts', async () => {
    const root = await tempDir('DiTing-skill-injector-paths-')
    const override = join(root, 'override-skills')
    const distSkills = join(root, 'dist', 'skills')
    const devSkills = join(root, 'packages', 'skills')
    await mkdir(override, { recursive: true })
    await mkdir(distSkills, { recursive: true })
    await mkdir(devSkills, { recursive: true })

    const { DiTingSkillInjector } = await import('../../packages/server/src/services/DiTing/skill-injector')

    expect(DiTingSkillInjector.resolveSourceDir({ DiTing_WEB_UI_SKILLS_DIR: override } as any, join(root, 'dist', 'server'))).toBe(override)
    expect(DiTingSkillInjector.resolveSourceDir({} as any, join(root, 'dist', 'server'))).toBe(distSkills)
    expect(DiTingSkillInjector.resolveSourceDir({} as any, join(root, 'packages', 'server', 'src', 'services', 'DiTing'))).toBe(devSkills)
  })

  it('injects missing skills but skips existing user-owned skills with the same name', async () => {
    const source = await tempDir('DiTing-skill-source-')
    const DiTingHome = await tempDir('DiTing-skill-home-')
    process.env.DiTing_HOME = DiTingHome

    await mkdir(join(source, 'new-skill'), { recursive: true })
    await writeFile(join(source, 'new-skill', 'SKILL.md'), '# New Skill\n', 'utf-8')
    await mkdir(join(source, 'existing-skill'), { recursive: true })
    await writeFile(join(source, 'existing-skill', 'SKILL.md'), '# Bundled Existing\n', 'utf-8')

    await mkdir(join(DiTingHome, 'skills', 'existing-skill'), { recursive: true })
    await writeFile(join(DiTingHome, 'skills', 'existing-skill', 'SKILL.md'), '# User Existing\n', 'utf-8')

    const { DiTingSkillInjector } = await import('../../packages/server/src/services/DiTing/skill-injector')
    const result = await new DiTingSkillInjector(source).injectMissingSkills()

    expect(result.injected).toEqual(['new-skill'])
    expect(result.updated).toEqual([])
    expect(result.skipped).toEqual(['existing-skill'])
    await expect(readFile(join(DiTingHome, 'skills', 'new-skill', 'SKILL.md'), 'utf-8')).resolves.toBe('# New Skill\n')
    await expect(readFile(join(DiTingHome, 'skills', 'existing-skill', 'SKILL.md'), 'utf-8')).resolves.toBe('# User Existing\n')
    await expect(readManifest(join(DiTingHome, 'skills'))).resolves.toMatchObject({ 'new-skill': { owner: 'DiTing-web-ui' } })
    expect(existsSync(join(DiTingHome, 'skills', 'new-skill', '.wui-managed.json'))).toBe(false)
    expect(existsSync(join(DiTingHome, 'skills', 'existing-skill', '.wui-managed.json'))).toBe(false)
  })

  it('updates existing Web UI-managed bundled copies', async () => {
    const sourceV1 = await tempDir('DiTing-skill-source-v1-')
    const sourceV2 = await tempDir('DiTing-skill-source-v2-')
    const DiTingHome = await tempDir('DiTing-skill-home-')
    process.env.DiTing_HOME = DiTingHome

    await mkdir(join(sourceV1, 'webui-skill'), { recursive: true })
    await writeFile(join(sourceV1, 'webui-skill', 'SKILL.md'), '# WebUI Skill v1\n', 'utf-8')
    await mkdir(join(sourceV2, 'webui-skill'), { recursive: true })
    await writeFile(join(sourceV2, 'webui-skill', 'SKILL.md'), '# WebUI Skill v2\n', 'utf-8')

    const { DiTingSkillInjector } = await import('../../packages/server/src/services/DiTing/skill-injector')
    await new DiTingSkillInjector(sourceV1).injectMissingSkills()
    const result = await new DiTingSkillInjector(sourceV2).injectMissingSkills()

    expect(result.injected).toEqual([])
    expect(result.updated).toEqual(['webui-skill'])
    expect(result.skipped).toEqual([])
    await expect(readFile(join(DiTingHome, 'skills', 'webui-skill', 'SKILL.md'), 'utf-8')).resolves.toBe('# WebUI Skill v2\n')
    await expect(readManifest(join(DiTingHome, 'skills'))).resolves.toMatchObject({ 'webui-skill': { owner: 'DiTing-web-ui' } })
  })

  it('ignores common OS metadata files when deciding whether a managed copy can update', async () => {
    const sourceV1 = await tempDir('DiTing-skill-source-v1-')
    const sourceV2 = await tempDir('DiTing-skill-source-v2-')
    const DiTingHome = await tempDir('DiTing-skill-home-')
    process.env.DiTing_HOME = DiTingHome

    await mkdir(join(sourceV1, 'webui-skill'), { recursive: true })
    await writeFile(join(sourceV1, 'webui-skill', 'SKILL.md'), '# WebUI Skill v1\n', 'utf-8')
    await mkdir(join(sourceV2, 'webui-skill'), { recursive: true })
    await writeFile(join(sourceV2, 'webui-skill', 'SKILL.md'), '# WebUI Skill v2\n', 'utf-8')

    const { DiTingSkillInjector } = await import('../../packages/server/src/services/DiTing/skill-injector')
    await new DiTingSkillInjector(sourceV1).injectMissingSkills()
    await writeFile(join(DiTingHome, 'skills', 'webui-skill', '.DS_Store'), 'finder metadata', 'utf-8')
    const result = await new DiTingSkillInjector(sourceV2).injectMissingSkills()

    expect(result.updated).toEqual(['webui-skill'])
    expect(result.skipped).toEqual([])
    await expect(readFile(join(DiTingHome, 'skills', 'webui-skill', 'SKILL.md'), 'utf-8')).resolves.toBe('# WebUI Skill v2\n')
  })

  it('adopts identical existing bundled copies without overwriting local files', async () => {
    const source = await tempDir('DiTing-skill-source-')
    const DiTingHome = await tempDir('DiTing-skill-home-')
    process.env.DiTing_HOME = DiTingHome

    await mkdir(join(source, 'webui-skill'), { recursive: true })
    await writeFile(join(source, 'webui-skill', 'SKILL.md'), '# WebUI Skill\n', 'utf-8')
    await mkdir(join(DiTingHome, 'skills', 'webui-skill'), { recursive: true })
    await writeFile(join(DiTingHome, 'skills', 'webui-skill', 'SKILL.md'), '# WebUI Skill\n', 'utf-8')

    const { DiTingSkillInjector } = await import('../../packages/server/src/services/DiTing/skill-injector')
    const result = await new DiTingSkillInjector(source).injectMissingSkills()

    expect(result.injected).toEqual([])
    expect(result.updated).toEqual(['webui-skill'])
    expect(result.skipped).toEqual([])
    await expect(readFile(join(DiTingHome, 'skills', 'webui-skill', 'SKILL.md'), 'utf-8')).resolves.toBe('# WebUI Skill\n')
    await expect(readManifest(join(DiTingHome, 'skills'))).resolves.toMatchObject({ 'webui-skill': { owner: 'DiTing-web-ui' } })
  })

  it('syncs bundled skills into default and named profiles without overwriting user-owned conflicts', async () => {
    const source = await tempDir('DiTing-skill-source-')
    const DiTingHome = await tempDir('DiTing-skill-home-')
    process.env.DiTing_HOME = DiTingHome

    await mkdir(join(source, 'webui-skill'), { recursive: true })
    await writeFile(join(source, 'webui-skill', 'SKILL.md'), '# WebUI Skill\n', 'utf-8')

    await mkdir(join(DiTingHome, 'skills', 'webui-skill'), { recursive: true })
    await writeFile(join(DiTingHome, 'skills', 'webui-skill', 'SKILL.md'), '# User WebUI Skill\n', 'utf-8')
    await mkdir(join(DiTingHome, 'skills', 'local-skill'), { recursive: true })
    await writeFile(join(DiTingHome, 'skills', 'local-skill', 'SKILL.md'), '# Local Skill\n', 'utf-8')

    await mkdir(join(DiTingHome, 'profiles', 'alpha', 'skills'), { recursive: true })
    await mkdir(join(DiTingHome, 'profiles', 'beta', 'skills', 'webui-skill'), { recursive: true })
    await writeFile(join(DiTingHome, 'profiles', 'beta', 'skills', 'webui-skill', 'SKILL.md'), '# Old Profile Skill\n', 'utf-8')
    await mkdir(join(DiTingHome, 'profiles', 'beta', 'skills', 'profile-local'), { recursive: true })
    await writeFile(join(DiTingHome, 'profiles', 'beta', 'skills', 'profile-local', 'SKILL.md'), '# Profile Local\n', 'utf-8')

    const { DiTingSkillInjector } = await import('../../packages/server/src/services/DiTing/skill-injector')
    const result = await new DiTingSkillInjector(source).injectMissingSkills()

    expect(result.targets.map(target => target.targetDir)).toEqual([
      join(DiTingHome, 'skills'),
      join(DiTingHome, 'profiles', 'alpha', 'skills'),
      join(DiTingHome, 'profiles', 'beta', 'skills'),
    ])
    expect(result.injected).toEqual(['webui-skill'])
    expect(result.updated).toEqual([])
    expect(result.skipped).toEqual(['webui-skill', 'webui-skill'])

    await expect(readFile(join(DiTingHome, 'skills', 'webui-skill', 'SKILL.md'), 'utf-8')).resolves.toBe('# User WebUI Skill\n')
    await expect(readFile(join(DiTingHome, 'profiles', 'alpha', 'skills', 'webui-skill', 'SKILL.md'), 'utf-8')).resolves.toBe('# WebUI Skill\n')
    await expect(readFile(join(DiTingHome, 'profiles', 'beta', 'skills', 'webui-skill', 'SKILL.md'), 'utf-8')).resolves.toBe('# Old Profile Skill\n')
    await expect(readFile(join(DiTingHome, 'skills', 'local-skill', 'SKILL.md'), 'utf-8')).resolves.toBe('# Local Skill\n')
    await expect(readFile(join(DiTingHome, 'profiles', 'beta', 'skills', 'profile-local', 'SKILL.md'), 'utf-8')).resolves.toBe('# Profile Local\n')
  })
})
