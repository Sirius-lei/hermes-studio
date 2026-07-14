import { chromium } from "playwright"

const url = "http://127.0.0.1:8649/#/DiTing/chat"
const screenshotPath = "/private/tmp/DiTing-chat-ui-after-login.png"
const prompt = process.env.DiTing_CHAT_PROMPT || "帮我查询一下张三的涉案信息"
const waitAfterSendMs = Number(process.env.DiTing_CHAT_WAIT_MS || 2500)
const expandWorkflow = process.env.DiTing_EXPAND_WORKFLOW === "1"

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })

try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 120000 })

  const username = page.getByPlaceholder(/username/i)
  const password = page.getByPlaceholder(/password/i)

  if (await username.isVisible().catch(() => false)) {
    await username.fill("admin")
    await password.fill("123456")
    await page.getByRole("button", { name: /login/i }).click()
    await page.waitForLoadState("networkidle", { timeout: 120000 })
    await page.waitForTimeout(3000)
  }

  const remindLater = page.getByRole("button", { name: /remind me later/i })
  if (await remindLater.isVisible().catch(() => false)) {
    await remindLater.click()
    await page.waitForTimeout(500)
  }

  const newChatButton = page.getByRole("button", { name: /new chat|新建对话/i }).first()
  if (await newChatButton.isVisible().catch(() => false)) {
    await newChatButton.click()
    await page.waitForTimeout(800)
    await page.keyboard.press("Escape").catch(() => {})
    await page.waitForTimeout(300)
  }

  const multiAgentToggle = page.getByRole("button", { name: /多智能体|multi-agent/i }).first()
  if (await multiAgentToggle.isVisible().catch(() => false)) {
    await multiAgentToggle.click()
    await page.waitForTimeout(800)
  }

  const chatInput = page.getByPlaceholder(/type a message|输入消息/i).first()
  if (await chatInput.isVisible().catch(() => false)) {
    await chatInput.fill(prompt)
    await chatInput.press("Enter")
    await page.waitForTimeout(waitAfterSendMs)
  }

  if (expandWorkflow) {
    const workflowToggle = page.getByRole("button", { name: /执行过程/i }).first()
    if (await workflowToggle.isVisible().catch(() => false)) {
      await workflowToggle.click()
      await page.waitForTimeout(400)
    }
  }

  const taskObjective = page.getByText("任务目标").first()
  if (await taskObjective.waitFor({ state: "visible", timeout: 30000 }).catch(() => null)) {
    const planToggle = page.getByTestId("multi-agent-plan-toggle")
    const planExpandedLabel = page.getByText("意图识别").first()
    const hasExpandedPlan = await planExpandedLabel.isVisible().catch(() => false)
    if (!hasExpandedPlan && await planToggle.isVisible().catch(() => false)) {
      await planToggle.click()
      await page.waitForTimeout(300)
    }
  }

  await page.screenshot({ path: screenshotPath, fullPage: true })
  console.log(screenshotPath)
} finally {
  await browser.close()
}
