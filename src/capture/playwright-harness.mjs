import fs from "fs"
import path from "path"
import { spawn } from "child_process"

const DEFAULT_DEVICES = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
]

const SUPPORTED_ACTION_TYPES = new Set([
  "goto",
  "waitForSelector",
  "click",
  "press",
  "fill",
  "check",
  "uncheck",
  "wait",
  "storeFirstLink",
  "storeFirstLinkWithSelector",
  "gotoStored",
  "toggleUntilAttribute",
])

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer(url, timeoutMs = 120000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" })
      if (response.ok) return true
    } catch {
      // retry
    }
    await sleep(500)
  }
  return false
}

function normalizeStartCommand(startCommand) {
  if (!startCommand) return null
  if (typeof startCommand === "string") {
    return {
      command: "npm",
      args: ["run", startCommand],
    }
  }
  if (typeof startCommand === "object" && startCommand.command) {
    return {
      command: startCommand.command,
      args: Array.isArray(startCommand.args) ? startCommand.args : [],
    }
  }
  throw new Error("Invalid capture.playwright.startCommand. Use a script name string or { command, args }.")
}

async function ensureServer({ baseUrl, timeoutMs, startCommand, env, cwd, logger }) {
  if (!baseUrl) return { proc: null }

  const alreadyReady = await waitForServer(baseUrl, 2000)
  if (alreadyReady) {
    return { proc: null }
  }

  const normalizedStart = normalizeStartCommand(startCommand)
  if (!normalizedStart) {
    throw new Error(`Server at ${baseUrl} is not reachable and no startCommand is configured.`)
  }

  logger?.log?.(`Starting capture server: ${normalizedStart.command} ${normalizedStart.args.join(" ")}`)
  const proc = spawn(normalizedStart.command, normalizedStart.args, {
    cwd,
    stdio: "inherit",
    env,
  })

  const ready = await waitForServer(baseUrl, timeoutMs)
  if (!ready) {
    proc.kill("SIGTERM")
    throw new Error(`Capture server did not become ready at ${baseUrl}`)
  }

  return { proc }
}

async function applyAction(page, action) {
  const type = action?.type
  if (!type) {
    throw new Error("Each flow action must include a type.")
  }

  if (type === "goto") {
    await page.goto(action.url, { waitUntil: action.waitUntil || "domcontentloaded" })
    if (action.waitFor) {
      await page.waitForSelector(action.waitFor, { timeout: action.timeoutMs || 15000 })
    }
    if (action.settleMs) {
      await page.waitForTimeout(action.settleMs)
    }
    return
  }

  if (type === "waitForSelector") {
    await page.waitForSelector(action.selector, { timeout: action.timeoutMs || 15000 })
    return
  }

  if (type === "click") {
    await page.locator(action.selector).first().click()
    return
  }

  if (type === "press") {
    await page.keyboard.press(action.key)
    return
  }

  if (type === "fill") {
    await page.locator(action.selector).first().fill(action.value || "")
    return
  }

  if (type === "check") {
    await page.locator(action.selector).first().check()
    return
  }

  if (type === "uncheck") {
    await page.locator(action.selector).first().uncheck()
    return
  }

  if (type === "wait") {
    await page.waitForTimeout(action.ms || 250)
    return
  }

  throw new Error(`Unsupported flow action type: ${type}`)
}

function toAbsoluteUrl(baseUrl, maybeRelative) {
  if (!maybeRelative) return maybeRelative
  if (!baseUrl) return maybeRelative
  return new URL(maybeRelative, baseUrl).toString()
}

async function applyStatefulAction(page, action, runtime, baseUrl) {
  const type = action?.type

  if (type === "storeFirstLink") {
    const href = await page.locator(action.selector).first().getAttribute("href")
    const absolute = toAbsoluteUrl(baseUrl, href)
    if (!absolute && action.required !== false) {
      throw new Error(`storeFirstLink did not find href for selector: ${action.selector}`)
    }
    runtime[action.storeAs] = absolute || null
    return
  }

  if (type === "storeFirstLinkWithSelector") {
    const hrefs = await page.locator(action.linkSelector).evaluateAll((links) =>
      links
        .map((link) => link.getAttribute("href"))
        .filter((href) => typeof href === "string" && href.trim())
    )

    let found = null
    for (const href of hrefs) {
      const candidate = toAbsoluteUrl(baseUrl, href)
      try {
        await page.goto(candidate, { waitUntil: action.waitUntil || "domcontentloaded" })
        if (action.waitFor) {
          await page.waitForSelector(action.waitFor, { timeout: action.timeoutMs || 15000 })
        }
        const count = await page.locator(action.targetSelector).count()
        if (count > 0) {
          found = candidate
          break
        }
      } catch {
        // continue
      }
    }

    if (!found && action.fallbackKey) {
      found = runtime[action.fallbackKey] || null
    }

    if (!found && action.required !== false) {
      throw new Error(`storeFirstLinkWithSelector could not resolve a page for target selector: ${action.targetSelector}`)
    }

    runtime[action.storeAs] = found
    return
  }

  if (type === "gotoStored") {
    const url = runtime[action.key]
    if (!url) {
      throw new Error(`gotoStored could not find runtime key: ${action.key}`)
    }
    await page.goto(url, { waitUntil: action.waitUntil || "domcontentloaded" })
    if (action.waitFor) {
      await page.waitForSelector(action.waitFor, { timeout: action.timeoutMs || 15000 })
    }
    if (action.settleMs) {
      await page.waitForTimeout(action.settleMs)
    }
    return
  }

  if (type === "toggleUntilAttribute") {
    const maxClicks = Number.isFinite(action.maxClicks) ? action.maxClicks : 4
    for (let i = 0; i < maxClicks; i += 1) {
      const current = await page.locator(action.targetSelector).first().getAttribute(action.attribute)
      if (current === action.value) {
        return
      }
      await page.locator(action.toggleSelector).first().click()
      await page.waitForTimeout(action.waitMs || 150)
    }

    const finalValue = await page.locator(action.targetSelector).first().getAttribute(action.attribute)
    if (finalValue !== action.value && action.required !== false) {
      throw new Error(`toggleUntilAttribute did not reach ${action.attribute}=${action.value}`)
    }
    return
  }

  await applyAction(page, action)
}

function resolveDevice(device, playwrightDevices) {
  if (!device?.name) {
    throw new Error("Each capture device must include a unique name.")
  }

  if (device.playwrightDevice) {
    const descriptor = playwrightDevices[device.playwrightDevice]
    if (!descriptor) {
      throw new Error(`Unknown Playwright device preset: ${device.playwrightDevice}`)
    }
    return {
      name: device.name,
      contextOptions: descriptor,
      viewport: descriptor.viewport,
    }
  }

  if (!Number.isFinite(device.width) || !Number.isFinite(device.height)) {
    throw new Error(`Device \"${device.name}\" must set width/height or playwrightDevice.`)
  }

  return {
    name: device.name,
    contextOptions: {},
    viewport: { width: device.width, height: device.height },
  }
}

function resolveFlowUrl(baseUrl, flowPathOrUrl) {
  if (!flowPathOrUrl) {
    return baseUrl
  }
  if (!baseUrl) {
    return flowPathOrUrl
  }
  return new URL(flowPathOrUrl, baseUrl).toString()
}

async function runFlow({ page, flow, baseUrl, shotsDir, deviceName, runtime }) {
  const screenshotName = flow.screenshot?.name || flow.name || flow.slug
  if (!screenshotName) {
    throw new Error(`Flow \"${flow.label || "(unnamed)"}\" must define screenshot.name or name.`)
  }

  const url = resolveFlowUrl(baseUrl, flow.path)
  if (url) {
    await page.goto(url, { waitUntil: flow.waitUntil || "domcontentloaded" })
  }

  if (flow.waitFor) {
    await page.waitForSelector(flow.waitFor, { timeout: flow.timeoutMs || 15000 })
  }

  if (Array.isArray(flow.actions)) {
    for (const action of flow.actions) {
      const normalizedAction = action.type === "goto" && action.path
        ? { ...action, url: resolveFlowUrl(baseUrl, action.path) }
        : action
      await applyStatefulAction(page, normalizedAction, runtime, baseUrl)
    }
  }

  if (flow.settleMs) {
    await page.waitForTimeout(flow.settleMs)
  }

  const screenshotPath = path.join(shotsDir, `${screenshotName}-${deviceName}.png`)

  if (flow.screenshot?.selector) {
    const target = page.locator(flow.screenshot.selector).first()
    await target.scrollIntoViewIfNeeded()
    await page.waitForTimeout(150)
    await target.screenshot({ path: screenshotPath })
  } else {
    await page.screenshot({
      path: screenshotPath,
      fullPage: flow.screenshot?.fullPage !== false,
      animations: flow.screenshot?.animations || "disabled",
    })
  }

  return screenshotPath
}

export function createPlaywrightCaptureHarness(options = {}) {
  validatePlaywrightCaptureDefinition(options)
  const devices = Array.isArray(options.devices) && options.devices.length > 0 ? options.devices : DEFAULT_DEVICES
  const flows = Array.isArray(options.flows) ? options.flows : []

  return async function captureUx(context) {
    const playwright = await import("playwright")
    const chromium = playwright.chromium
    const playwrightDevices = playwright.devices

    const baseUrl = options.baseUrl || context.baseUrl
    const timeoutMs = options.timeoutMs || context.timeoutMs || 120000
    const shotsDir = context.shotsDir
    const rootDir = context.rootDir
    const logger = context.logger || console

    if (!shotsDir) {
      throw new Error("Capture context is missing shotsDir.")
    }

    const resolvedFlows = flows.length > 0
      ? flows
      : [
          {
            label: "Home — Mobile vs Desktop",
            name: "home",
            path: "/",
            waitFor: "body",
            settleMs: 200,
            screenshot: { fullPage: true },
          },
        ]

    fs.mkdirSync(shotsDir, { recursive: true })

    const server = await ensureServer({
      baseUrl,
      timeoutMs,
      startCommand: options.startCommand,
      env: { ...process.env, ...(context.env || {}), ...(options.env || {}) },
      cwd: rootDir,
      logger,
    })

    const browser = await chromium.launch(options.launch || {})

    try {
      const groups = []
      const runtime = {}

      for (const flow of resolvedFlows) {
        if (!flow.label) {
          throw new Error("Each flow must include a label.")
        }

        const files = []

        for (const rawDevice of devices) {
          const device = resolveDevice(rawDevice, playwrightDevices)
          const browserContext = await browser.newContext(device.contextOptions)
          const page = await browserContext.newPage()

          try {
            if (device.viewport) {
              await page.setViewportSize(device.viewport)
            }
            const screenshotPath = await runFlow({
              page,
              flow,
              baseUrl,
              shotsDir,
              deviceName: device.name,
              runtime,
            })
            files.push(screenshotPath)
          } finally {
            await browserContext.close()
          }
        }

        groups.push({
          label: flow.label,
          files,
        })
      }

      return groups
    } finally {
      await browser.close()
      if (server.proc) {
        server.proc.kill("SIGTERM")
      }
    }
  }
}

export const defaultCaptureDevices = DEFAULT_DEVICES

export function validatePlaywrightCaptureDefinition(options = {}) {
  if (options.devices !== undefined) {
    if (!Array.isArray(options.devices) || options.devices.length === 0) {
      throw new Error("capture.playwright.devices must be a non-empty array when provided.")
    }

    const names = new Set()
    for (const device of options.devices) {
      if (!device || typeof device !== "object") {
        throw new Error("Each capture device must be an object.")
      }
      if (!device.name || typeof device.name !== "string") {
        throw new Error("Each capture device must include a string name.")
      }
      if (names.has(device.name)) {
        throw new Error(`Duplicate capture device name: ${device.name}`)
      }
      names.add(device.name)

      if (!device.playwrightDevice) {
        const hasDimensions = Number.isFinite(device.width) && Number.isFinite(device.height)
        if (!hasDimensions) {
          throw new Error(`Device \"${device.name}\" must set width/height or playwrightDevice.`)
        }
      }
    }
  }

  if (options.flows !== undefined) {
    if (!Array.isArray(options.flows)) {
      throw new Error("capture.playwright.flows must be an array when provided.")
    }

    for (const flow of options.flows) {
      if (!flow || typeof flow !== "object") {
        throw new Error("Each capture flow must be an object.")
      }
      if (!flow.label || typeof flow.label !== "string") {
        throw new Error("Each flow must include a label.")
      }
      if (!flow.screenshot?.name && !flow.name && !flow.slug) {
        throw new Error(`Flow \"${flow.label}\" must define screenshot.name, name, or slug.`)
      }

      if (flow.actions !== undefined) {
        if (!Array.isArray(flow.actions)) {
          throw new Error(`Flow \"${flow.label}\" actions must be an array.`)
        }
        for (const action of flow.actions) {
          if (!action || typeof action !== "object") {
            throw new Error(`Flow \"${flow.label}\" contains a non-object action.`)
          }
          if (!SUPPORTED_ACTION_TYPES.has(action.type)) {
            throw new Error(`Unsupported flow action type: ${action.type}`)
          }
        }
      }
    }
  }

  return true
}
