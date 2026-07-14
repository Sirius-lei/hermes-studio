import { describe, expect, it } from 'vitest'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { getCorsOrigins, getListenHost, getWebUiHome, shouldCreateWebUiDataDir } from '../../packages/server/src/config'

describe('server config', () => {
  it('defaults to an IPv4 bind host', () => {
    expect(getListenHost({})).toBe('0.0.0.0')
  })

  it('uses BIND_HOST when provided', () => {
    expect(getListenHost({ BIND_HOST: ' :: ' })).toBe('::')
  })

  it('ignores blank BIND_HOST values', () => {
    expect(getListenHost({ BIND_HOST: ' ' })).toBe('0.0.0.0')
  })

  it('defaults web-ui home to ~/.DiTing-web-ui', () => {
    expect(getWebUiHome({})).toBe(join(homedir(), '.DiTing-web-ui'))
  })

  it('uses DiTing_WEB_UI_HOME when provided', () => {
    expect(getWebUiHome({ DiTing_WEB_UI_HOME: ' ./tmp/DiTing-ui ' })).toBe(resolve('./tmp/DiTing-ui'))
  })

  it('uses DiTing_WEBUI_STATE_DIR as a compatibility alias', () => {
    expect(getWebUiHome({ DiTing_WEBUI_STATE_DIR: ' ./tmp/DiTing-state ' })).toBe(resolve('./tmp/DiTing-state'))
  })

  it('only creates the development data directory outside production', () => {
    expect(shouldCreateWebUiDataDir({ NODE_ENV: 'development' })).toBe(true)
    expect(shouldCreateWebUiDataDir({ NODE_ENV: 'production' })).toBe(false)
  })

  it('does not enable cross-origin requests by default', () => {
    expect(getCorsOrigins({})).toBe('')
  })

  it('uses CORS_ORIGINS when provided', () => {
    expect(getCorsOrigins({ CORS_ORIGINS: ' https://app.example, http://localhost:3000 ' })).toBe('https://app.example, http://localhost:3000')
  })
})
