import { expect, test } from '@playwright/test'
import { authenticate, mockDiTingApi, TEST_ACCESS_KEY } from './fixtures'

test('renders authenticated shell and navigates between key product routes', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  const api = await mockDiTingApi(page)

  await page.goto('/#/DiTing/jobs')

  await expect(page.getByRole('heading', { name: 'Scheduled Jobs' })).toBeVisible()
  await expect(page.getByText('Nightly Smoke')).toBeVisible()

  const jobsRequest = api.requests.find((request) => request.pathname === '/api/DiTing/jobs')
  expect(jobsRequest?.headers.authorization).toBe(`Bearer ${TEST_ACCESS_KEY}`)
  expect(jobsRequest?.headers['x-DiTing-profile']).toBe('research')
  const cronHistoryRequest = api.requests.find((request) => request.pathname === '/api/cron-history')
  expect(cronHistoryRequest?.headers['x-DiTing-profile']).toBe('research')

  const modelsLink = page.locator('aside.sidebar').getByRole('link', { name: /^Models$/ })
  await expect(modelsLink).toHaveAttribute('href', '#/DiTing/models')
  await modelsLink.click()
  await expect(page).toHaveURL(/#\/DiTing\/models$/)
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible()
  await expect(page.getByText('test-model').first()).toBeVisible()

  const settingsLink = page.locator('aside.sidebar').getByRole('link', { name: /^Settings$/ })
  await expect(settingsLink).toHaveAttribute('href', '#/DiTing/settings')
  await settingsLink.click()
  await expect(page).toHaveURL(/#\/DiTing\/settings$/)
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  expect(api.unexpectedRequests).toEqual([])
})
