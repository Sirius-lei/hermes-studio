import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import YAML from 'js-yaml'

const originalDiTingHome = process.env.DiTing_HOME
const tempHomes: string[] = []
let DiTingHome = ''

async function loadHelpers() {
  vi.resetModules()
  process.env.DiTing_HOME = DiTingHome
  return import('../../packages/server/src/services/config-helpers')
}

beforeEach(async () => {
  DiTingHome = await mkdtemp(join(tmpdir(), 'DiTing-config-helpers-'))
  tempHomes.push(DiTingHome)
  await mkdir(DiTingHome, { recursive: true })
})

afterEach(async () => {
  vi.resetModules()
  if (originalDiTingHome === undefined) delete process.env.DiTing_HOME
  else process.env.DiTing_HOME = originalDiTingHome
  await Promise.all(tempHomes.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  DiTingHome = ''
})

describe('config-helpers locked file updates', () => {
  it('merges concurrent config.yaml updates by re-reading under the file lock', async () => {
    await writeFile(join(DiTingHome, 'config.yaml'), 'model:\n  default: old\n', 'utf-8')
    const { updateConfigYaml } = await loadHelpers()

    await Promise.all([
      updateConfigYaml(async (cfg) => {
        await new Promise(resolve => setTimeout(resolve, 25))
        cfg.model.default = 'glm-5.1'
        return cfg
      }),
      updateConfigYaml((cfg) => {
        cfg.platforms = cfg.platforms || {}
        cfg.platforms.api_server = { extra: { port: 8648 } }
        return cfg
      }),
    ])

    const config = YAML.load(await readFile(join(DiTingHome, 'config.yaml'), 'utf-8')) as any
    expect(config.model.default).toBe('glm-5.1')
    expect(config.platforms.api_server.extra.port).toBe(8648)
    await expect(readFile(join(DiTingHome, 'config.yaml.bak'), 'utf-8')).resolves.toContain('model:')
  })

  it('serializes concurrent .env updates without losing keys', async () => {
    await writeFile(join(DiTingHome, '.env'), 'OPENROUTER_API_KEY=keep\n', 'utf-8')
    const { saveEnvValue } = await loadHelpers()

    await Promise.all([
      saveEnvValue('DEEPSEEK_API_KEY', 'deepseek'),
      saveEnvValue('MOONSHOT_API_KEY', 'moonshot'),
    ])

    const env = await readFile(join(DiTingHome, '.env'), 'utf-8')
    expect(env).toContain('OPENROUTER_API_KEY=keep')
    expect(env).toContain('DEEPSEEK_API_KEY=deepseek')
    expect(env).toContain('MOONSHOT_API_KEY=moonshot')
  })

  it('rejects invalid .env keys instead of writing keyless lines', async () => {
    const envPath = join(DiTingHome, '.env')
    await writeFile(envPath, 'OPENROUTER_API_KEY=keep\n', 'utf-8')
    const { saveEnvValue } = await loadHelpers()

    await expect(saveEnvValue('', 'leaked-value')).rejects.toThrow('Invalid .env key')
    await expect(saveEnvValue('=BROKEN', 'leaked-value')).rejects.toThrow('Invalid .env key')

    const env = await readFile(envPath, 'utf-8')
    expect(env).toBe('OPENROUTER_API_KEY=keep\n')
    expect(env).not.toContain('=leaked-value')
  })

  it('skips writing config.yaml when an updater returns write false', async () => {
    const configPath = join(DiTingHome, 'config.yaml')
    await writeFile(configPath, 'model:\n  default: old\n', 'utf-8')
    const before = await readFile(configPath, 'utf-8')
    const { updateConfigYaml } = await loadHelpers()

    const result = await updateConfigYaml((cfg) => ({ data: cfg, result: 'unchanged', write: false }))

    expect(result).toBe('unchanged')
    await expect(readFile(configPath, 'utf-8')).resolves.toBe(before)
    await expect(readFile(`${configPath}.bak`, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
