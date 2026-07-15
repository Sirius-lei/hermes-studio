import { expect, test } from '@playwright/test'
import { authenticate, mockDiTingApi, TEST_ACCESS_KEY } from './fixtures'

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
