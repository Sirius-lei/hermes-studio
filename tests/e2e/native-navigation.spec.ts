import { expect, test } from '@playwright/test'
import { authenticate, mockChatSocket, mockDiTingApi, TEST_ACCESS_KEY, TEST_USER_ACCESS_KEY } from './fixtures'

const sampleSession = {
  id: 'session-native-1',
  title: 'Native Link Session',
  source: 'cli',
  model: 'test-model',
  provider: 'test-provider',
  profile: 'research',
  started_at: 1_700_000_000,
  ended_at: null,
  last_active: 1_700_000_100,
  message_count: 2,
}

test('sidebar navigation exposes native links', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await mockDiTingApi(page)
  await page.goto('/#/DiTing/jobs')

  const models = page.locator('aside.sidebar').getByRole('link', { name: /^Models$/ })
  await expect(models).toHaveAttribute('href', '#/DiTing/models')

  const settings = page.locator('aside.sidebar').getByRole('link', { name: /^Settings$/ })
  await expect(settings).toHaveAttribute('href', '#/DiTing/settings')
})

test('session rows expose native session links', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await mockDiTingApi(page, { sessions: [sampleSession] })
  await page.goto('/#/DiTing/chat')

  const sessionLink = page.locator('.session-items a.session-item').first()
  await expect(sessionLink).toHaveAttribute('href', '#/DiTing/session/session-native-1')
  await expect(sessionLink).toContainText('Native Link Session')
})

test('regular users get a simplified isolated chat surface', async ({ page }) => {
  await authenticate(page, TEST_USER_ACCESS_KEY, 'research')
  const api = await mockDiTingApi(page, { userRole: 'admin' })
  await mockChatSocket(page)
  await page.goto('/#/DiTing/chat')

  await expect(page.locator('.session-mode-switch')).toHaveCount(0)
  await expect(page.locator('aside.sidebar').getByRole('link', { name: /^Settings$/ })).toHaveCount(0)
  await expect(page.locator('.workspace-badge')).toHaveCount(0)
  await expect(page.locator('.header-tool-toggle')).toHaveCount(0)

  await page.locator('.session-primary-btn').click()
  await expect(page).toHaveURL(/#\/DiTing\/session\//)
  await expect(page.locator('.new-chat-drawer')).toHaveCount(0)
  expect(api.requests.some(request => request.method === 'POST' && request.pathname === '/api/DiTing/sessions')).toBe(true)

  await page.goto('/#/DiTing/settings')
  await expect(page).toHaveURL(/#\/DiTing\/chat$/)
})
