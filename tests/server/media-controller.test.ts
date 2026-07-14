import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalWebUiHome = process.env.DiTing_WEB_UI_HOME
const originalWebuiStateDir = process.env.DiTing_WEBUI_STATE_DIR

afterEach(() => {
  vi.doUnmock('../../packages/server/src/services/DiTing/DiTing-profile')
  vi.doUnmock('../../packages/server/src/services/config-helpers')
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.resetModules()
  if (originalWebUiHome === undefined) delete process.env.DiTing_WEB_UI_HOME
  else process.env.DiTing_WEB_UI_HOME = originalWebUiHome
  if (originalWebuiStateDir === undefined) delete process.env.DiTing_WEBUI_STATE_DIR
  else process.env.DiTing_WEBUI_STATE_DIR = originalWebuiStateDir
})

describe('media controller', () => {
  it('uses DiTing Web UI media directory as the default generated video output path', async () => {
    process.env.DiTing_WEB_UI_HOME = '/tmp/DiTing-web-ui-test-home'
    const { defaultImageOutputPath, defaultMediaOutputPath } = await import('../../packages/server/src/controllers/DiTing/media')

    expect(defaultMediaOutputPath('req_123')).toBe(join('/tmp/DiTing-web-ui-test-home', 'media', 'req_123.mp4'))
    expect(defaultMediaOutputPath('bad/request:id')).toBe(join('/tmp/DiTing-web-ui-test-home', 'media', 'bad_request_id.mp4'))
    expect(defaultImageOutputPath('img_123')).toBe(join('/tmp/DiTing-web-ui-test-home', 'media', 'img_123.png'))
    expect(defaultImageOutputPath('bad/request:id', 1)).toBe(join('/tmp/DiTing-web-ui-test-home', 'media', 'bad_request_id-2.png'))
  })

  it('generates images through the requested configured custom provider', async () => {
    vi.stubEnv('AGNES_API_KEY', 'agnes-secret')
    vi.doMock('../../packages/server/src/services/DiTing/DiTing-profile', () => ({
      getActiveProfileName: () => 'default',
      getProfileDir: () => '/tmp/DiTing-web-ui-test-profile',
      listProfileNamesFromDisk: () => ['default'],
    }))
    vi.doMock('../../packages/server/src/services/config-helpers', () => ({
      readConfigYamlForProfile: vi.fn(async () => ({
        custom_providers: [{
          name: 'agnes',
          base_url: 'https://agnes.example/v1',
          api_key_env: 'AGNES_API_KEY',
          model: 'agnes-image-2.1-flash',
        }],
      })),
    }))
    const fetchMock = vi.fn(async () => new Response(
      'data: {"data":[{"b64_json":"aW1hZ2UtYnl0ZXM="}]}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as any
    try {
      const { apiKeyImageGenerate } = await import('../../packages/server/src/controllers/DiTing/media')
      const ctx: any = {
        state: { serverTokenAuth: true },
        query: {},
        request: {
          body: {
            provider: 'agnes',
            mode: 'text',
            prompt: 'make an icon',
            output_path: '/tmp/DiTing-web-ui-agnes-image.png',
          },
        },
        get: vi.fn(() => ''),
        status: 200,
        body: undefined,
      }

      await apiKeyImageGenerate(ctx)

      expect(ctx.status).toBe(200)
      expect(ctx.body).toMatchObject({
        ok: true,
        mode: 'text',
        provider: 'agnes',
        base_url: 'https://agnes.example/v1',
        profile: 'default',
      })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://agnes.example/v1/images/generations',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer agnes-secret',
            'Content-Type': 'application/json',
          }),
        }),
      )
      const requestInit = fetchMock.mock.calls[0][1] as RequestInit
      expect(JSON.parse(String(requestInit.body))).toMatchObject({
        model: 'gpt-image-2',
        prompt: 'make an icon',
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
