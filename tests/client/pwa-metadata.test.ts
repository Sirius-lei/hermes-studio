import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

describe('PWA metadata', () => {
  it('links manifest and touch icon from the client shell', () => {
    const html = readFileSync('packages/client/index.html', 'utf8')

    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"')
    expect(html).toContain('rel="apple-touch-icon" href="/coding-agents/assistant-badge.svg"')
    expect(html).toContain('name="apple-mobile-web-app-title" content="智能体工作台"')
  })

  it('ships a standalone web manifest with the default primary-agent icon', () => {
    const manifest = JSON.parse(readFileSync('packages/client/public/manifest.webmanifest', 'utf8'))

    expect(manifest.name).toBe('智能体工作台')
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/#/hermes/chat')
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        src: '/coding-agents/assistant-badge.svg',
        type: 'image/svg+xml',
        purpose: 'any maskable',
      }),
    ]))
  })
})
