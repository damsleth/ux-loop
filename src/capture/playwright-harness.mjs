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

const SCREENSHOT_STABILIZER_CSS = `
*,
*::before,
*::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
}
input,
textarea,
[contenteditable="true"] {
  caret-color: transparent !important;
}
`.trim()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isServerReadyResponse(response) {
  return Boolean(response) && Number.isFinite(response.status) && response.status < 500
}

function waitForProcessExit(proc, timeoutMs = 3000) {
  if (!proc) return Promise.resolve(true)
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true)

  return new Promise((resolve) => {
    const onExit = () => {
      cleanup()
      resolve(true)
    }
    const cleanup = () => {
      clearTimeout(timer)
      proc.off("exit", onExit)
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve(false)
    }, timeoutMs)

    proc.on("exit", onExit)
  })
}

async function stopServerProcess(proc, logger) {
  if (!proc) return
  if (proc.exitCode !== null || proc.signalCode !== null) return

  logger?.log?.("Stopping capture server")

  try {
    proc.kill("SIGINT")
  } catch {
    return
  }

  if (await waitForProcessExit(proc, 3000)) return

  logger?.warn?.("Capture server did not stop on SIGINT, sending SIGTERM")
  try {
    proc.kill("SIGTERM")
  } catch {
    return
  }

  if (await waitForProcessExit(proc, 2000)) return

  logger?.warn?.("Capture server did not stop on SIGTERM, sending SIGKILL")
  try {
    proc.kill("SIGKILL")
  } catch {
    return
  }

  await waitForProcessExit(proc, 1000)
}

function buildServerProbeUrls(baseUrl) {
  let parsed
  try {
    parsed = new URL(baseUrl)
  } catch {
    return [baseUrl]
  }

  const hostname = parsed.hostname
  const isIpv4Loopback = /^127(?:\.\d{1,3}){3}$/.test(hostname)
  const isKnownLoopback = hostname === "localhost" || hostname === "0.0.0.0" || hostname === "::1" || isIpv4Loopback
  const aliases = isKnownLoopback ? ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"] : []
  const seen = new Set()
  const candidates = []

  for (const candidateHost of [hostname, ...aliases]) {
    const candidate = new URL(baseUrl)
    candidate.hostname = candidateHost
    const href = candidate.toString()
    if (!seen.has(href)) {
      seen.add(href)
      candidates.push(href)
    }
  }

  return candidates
}

async function waitForServer(url, timeoutMs = 120000) {
  const probeUrls = buildServerProbeUrls(url)
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    for (const probeUrl of probeUrls) {
      try {
        const response = await fetch(probeUrl, { method: "GET" })
        if (isServerReadyResponse(response)) return probeUrl
      } catch {
        // retry
      }
    }
    await sleep(500)
  }
  return null
}

function normalizeStartCommand(startCommand) {
  if (!startCommand) return null
  if (typeof startCommand === "string") {
    return {
      command: "npm",
      args: ["run", startCommand],
      env: {},
    }
  }
  if (typeof startCommand === "object" && startCommand.command) {
    return {
      command: startCommand.command,
      args: Array.isArray(startCommand.args) ? startCommand.args : [],
      env: startCommand.env && typeof startCommand.env === "object" ? { ...startCommand.env } : {},
    }
  }
  throw new Error("Invalid capture.playwright.startCommand. Use a script name string or { command, args }.")
}

const TITLE_REGEX = /<title[^>]*>([\s\S]*?)<\/title>/i

function decodeBasicEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function extractTitleFromHtml(html) {
  const match = TITLE_REGEX.exec(String(html || ""))
  if (!match) return null
  return decodeBasicEntities(match[1]).replace(/\s+/g, " ").trim()
}

export async function verifyServerIdentity({
  baseUrl,
  expectTitleIncludes,
  fetchFn = globalThis.fetch,
  logger,
  timeoutMs = 5000,
}) {
  if (!expectTitleIncludes) {
    logger?.warn?.("Skipping capture server identity check (no expectTitleIncludes configured).")
    return { checked: false, reason: "no-expectation" }
  }
  if (typeof fetchFn !== "function") {
    logger?.warn?.("Skipping capture server identity check (fetch not available in this runtime).")
    return { checked: false, reason: "no-fetch" }
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  let response
  try {
    response = await fetchFn(baseUrl, { signal: controller?.signal })
  } finally {
    if (timeout) clearTimeout(timeout)
  }
  const body = await response.text()
  const actualTitle = extractTitleFromHtml(body)
  const expected = String(expectTitleIncludes).toLowerCase()
  const normalizedActual = actualTitle ? actualTitle.toLowerCase() : ""
  if (actualTitle && normalizedActual.includes(expected)) {
    return { checked: true, matched: true, actualTitle }
  }
  const urlForHint = (() => {
    try {
      return new URL(baseUrl)
    } catch {
      return null
    }
  })()
  const portHint = urlForHint?.port
    ? `\nAnother process may be squatting this port. To find it:\n  lsof -iTCP:${urlForHint.port} -sTCP:LISTEN`
    : ""
  if (!actualTitle) {
    const snippet = String(body || "").slice(0, 200).replace(/\s+/g, " ").trim()
    throw new Error(
      `Capture server at ${baseUrl} did not return a parseable <title>.\n` +
        `  expected title to include: ${expectTitleIncludes}\n` +
        `  response snippet:          ${snippet || "(empty)"}${portHint}`
    )
  }
  throw new Error(
    `Capture server at ${baseUrl} does not match the expected fingerprint.\n` +
      `  expected title to include: ${expectTitleIncludes}\n` +
      `  actual title:              ${actualTitle}${portHint}`
  )
}

async function ensureServer({
  baseUrl,
  timeoutMs,
  startCommand,
  env,
  cwd,
  logger,
  spawnFn = spawn,
  waitForServerFn = waitForServer,
  expectTitleIncludes,
  verifyIdentityFn = verifyServerIdentity,
  reuseExistingServer = false,
}) {
  if (!baseUrl) return { proc: null, baseUrl }

  const runVerify = async (readyUrl) => {
    if (!expectTitleIncludes) return
    await verifyIdentityFn({ baseUrl: readyUrl, expectTitleIncludes, logger })
  }

  const alreadyReadyUrl = await waitForServerFn(baseUrl, reuseExistingServer ? 5000 : 1500)
  if (alreadyReadyUrl) {
    if (reuseExistingServer) {
      logger?.log?.(
        `Capture server already running at ${alreadyReadyUrl}; skipping startCommand (configured baseUrl: ${baseUrl})`
      )
      await runVerify(alreadyReadyUrl)
      return { proc: null, baseUrl: alreadyReadyUrl }
    }
    const portHint = (() => {
      try {
        const parsed = new URL(baseUrl)
        return parsed.port ? `\nRun: lsof -iTCP:${parsed.port} -sTCP:LISTEN` : ""
      } catch {
        return ""
      }
    })()
    throw new Error(
      `Port at ${baseUrl} is already in use; refusing to reuse it.${portHint}\n` +
        `Or set capture.playwright.reuseExistingServer: true to opt in.`
    )
  }

  const normalizedStart = normalizeStartCommand(startCommand)
  if (!normalizedStart) {
    throw new Error(`Server at ${baseUrl} is not reachable and no startCommand is configured.`)
  }

  logger?.log?.(`Starting capture server: ${normalizedStart.command} ${normalizedStart.args.join(" ")}`)
  const spawnEnv = { ...env, ...normalizedStart.env }
  const proc = spawnFn(normalizedStart.command, normalizedStart.args, {
    cwd,
    stdio: "inherit",
    env: spawnEnv,
  })

  let settled = false
  let onError
  let onExit
  const cleanupListeners = () => {
    if (onError) proc.off("error", onError)
    if (onExit) proc.off("exit", onExit)
  }

  const failurePromise = new Promise((_resolve, reject) => {
    onError = (err) => {
      if (settled) return
      settled = true
      cleanupListeners()
      const detail = err?.code ? `${err.code}: ${err.message}` : err?.message || String(err)
      reject(new Error(`Capture server failed to start: ${detail}`))
    }
    onExit = (code, signal) => {
      if (settled) return
      settled = true
      cleanupListeners()
      reject(new Error(`Capture server exited before becoming ready (code=${code}, signal=${signal})`))
    }
    proc.on("error", onError)
    proc.on("exit", onExit)
  })

  let readyUrl
  try {
    readyUrl = await Promise.race([waitForServerFn(baseUrl, timeoutMs), failurePromise])
  } catch (err) {
    try {
      await stopServerProcess(proc, logger)
    } catch {
      // best-effort cleanup
    }
    throw err
  } finally {
    if (!settled) {
      settled = true
      cleanupListeners()
    }
  }

  if (!readyUrl) {
    await stopServerProcess(proc, logger)
    throw new Error(`Capture server did not become ready at ${baseUrl}`)
  }

  if (readyUrl !== baseUrl) {
    logger?.log?.(`Capture server is ready at ${readyUrl} (configured baseUrl: ${baseUrl})`)
  }

  try {
    await runVerify(readyUrl)
  } catch (err) {
    await stopServerProcess(proc, logger)
    throw err
  }

  return { proc, baseUrl: readyUrl }
}

export { ensureServer }

function getActionTimeout(action) {
  return action.timeout ?? action.timeoutMs ?? 15000
}

async function runWithRetries(task, { retries = 2, backoffMs = 250, logger, description }) {
  let lastError
  const totalAttempts = retries + 1
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      if (attempt >= totalAttempts) break
      logger?.warn?.(`${description} failed (attempt ${attempt}/${totalAttempts}); retrying.`)
      await sleep(backoffMs)
    }
  }
  throw lastError
}

async function ensureViewport(page, viewport) {
  if (!viewport) return
  await page.setViewportSize(viewport)
}

async function gotoWithViewport(page, url, action, viewport) {
  await ensureViewport(page, viewport)
  await page.goto(url, { waitUntil: action.waitUntil || "domcontentloaded" })
  await ensureViewport(page, viewport)
}

async function applyAction(page, action, options = {}) {
  const type = action?.type
  if (!type) {
    throw new Error("Each flow action must include a type.")
  }

  const retries = options.actionRetries ?? 2
  const backoffMs = options.actionRetryBackoffMs ?? 250
  const logger = options.logger
  const viewport = options.viewport

  if (type === "goto") {
    await gotoWithViewport(page, action.url, action, viewport)
    if (action.waitFor) {
      await page.waitForSelector(action.waitFor, { timeout: getActionTimeout(action) })
    }
    if (action.settleMs) {
      await page.waitForTimeout(action.settleMs)
    }
    return
  }

  if (type === "waitForSelector") {
    await runWithRetries(
      () => page.waitForSelector(action.selector, { timeout: getActionTimeout(action) }),
      { retries, backoffMs, logger, description: `Selector ${action.selector}` }
    )
    return
  }

  if (type === "click") {
    await runWithRetries(
      () => page.locator(action.selector).first().click({ timeout: getActionTimeout(action) }),
      { retries, backoffMs, logger, description: `Click ${action.selector}` }
    )
    return
  }

  if (type === "press") {
    await page.keyboard.press(action.key)
    return
  }

  if (type === "fill") {
    await runWithRetries(
      () => page.locator(action.selector).first().fill(action.value || "", { timeout: getActionTimeout(action) }),
      { retries, backoffMs, logger, description: `Fill ${action.selector}` }
    )
    return
  }

  if (type === "check") {
    await runWithRetries(
      () => page.locator(action.selector).first().check({ timeout: getActionTimeout(action) }),
      { retries, backoffMs, logger, description: `Check ${action.selector}` }
    )
    return
  }

  if (type === "uncheck") {
    await runWithRetries(
      () => page.locator(action.selector).first().uncheck({ timeout: getActionTimeout(action) }),
      { retries, backoffMs, logger, description: `Uncheck ${action.selector}` }
    )
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

export async function applyStatefulAction(page, action, runtime, baseUrl, options = {}) {
  const type = action?.type
  const retries = options.actionRetries ?? 2
  const backoffMs = options.actionRetryBackoffMs ?? 250
  const logger = options.logger
  const viewport = options.viewport

  if (type === "storeFirstLink") {
    const href = await runWithRetries(
      () => page.locator(action.selector).first().getAttribute("href"),
      { retries, backoffMs, logger, description: `Read link ${action.selector}` }
    )
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
        await gotoWithViewport(page, candidate, action, viewport)
        if (action.waitFor) {
          await page.waitForSelector(action.waitFor, { timeout: getActionTimeout(action) })
        }
        const count = await page.locator(action.targetSelector).count()
        if (count > 0) {
          found = candidate
          break
        }
      } catch (error) {
        logger?.warn?.(
          `storeFirstLinkWithSelector skipped candidate ${candidate}: ${error instanceof Error ? error.message : error}`
        )
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
    await gotoWithViewport(page, url, action, viewport)
    if (action.waitFor) {
      await page.waitForSelector(action.waitFor, { timeout: getActionTimeout(action) })
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
      await page.locator(action.toggleSelector).first().click({ timeout: getActionTimeout(action) })
      await page.waitForTimeout(action.waitMs || 150)
    }

    const finalValue = await page.locator(action.targetSelector).first().getAttribute(action.attribute)
    if (finalValue !== action.value) {
      if (action.required !== false) {
        throw new Error(`toggleUntilAttribute did not reach ${action.attribute}=${action.value}`)
      }
      logger?.warn?.(`toggleUntilAttribute did not reach ${action.attribute}=${action.value}`)
    }
    return
  }

  await applyAction(page, action, options)
}

function clampViewport(viewport, maxResolution, logger, deviceName) {
  if (!viewport || !maxResolution?.width || !maxResolution?.height) {
    return viewport
  }

  const widthScale = maxResolution.width / viewport.width
  const heightScale = maxResolution.height / viewport.height
  const scale = Math.min(1, widthScale, heightScale)
  if (scale === 1) {
    return viewport
  }

  const clamped = {
    width: Math.max(1, Math.floor(viewport.width * scale)),
    height: Math.max(1, Math.floor(viewport.height * scale)),
  }
  logger?.warn?.(
    `Clamping viewport for ${deviceName}: ${viewport.width}x${viewport.height} -> ${clamped.width}x${clamped.height}`
  )
  return clamped
}

function resolveDevice(device, playwrightDevices, maxResolution, logger) {
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
      viewport: clampViewport(descriptor.viewport, maxResolution, logger, device.name),
    }
  }

  if (!Number.isFinite(device.width) || !Number.isFinite(device.height)) {
    throw new Error(`Device "${device.name}" must set width/height or playwrightDevice.`)
  }

  const viewport = clampViewport({ width: device.width, height: device.height }, maxResolution, logger, device.name)
  return {
    name: device.name,
    contextOptions: {},
    viewport,
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

async function prepareScreenshot(page, flow, options) {
  await page.addStyleTag({ content: SCREENSHOT_STABILIZER_CSS })
  await page.waitForLoadState(flow.screenshot?.waitUntil || options.screenshotWaitUntil || "load")
  await page.waitForTimeout(flow.screenshot?.stabilizationDelayMs ?? options.stabilizationDelayMs ?? 200)
}

export function registerPlannedScreenshotPath({
  plannedPaths,
  resolvedScreenshotPath,
  screenshotPath,
  rawScreenshotName,
  rawDeviceName,
  flowLabel,
}) {
  const existing = plannedPaths.get(resolvedScreenshotPath)
  const planned = { rawName: rawScreenshotName, rawDevice: rawDeviceName, flowLabel }
  if (!existing) {
    plannedPaths.set(resolvedScreenshotPath, planned)
    return
  }
  const sameRaw =
    existing.rawName === planned.rawName &&
    existing.rawDevice === planned.rawDevice &&
    existing.flowLabel === planned.flowLabel
  if (sameRaw) return
  throw new Error(
    `Sanitized screenshot collision for ${screenshotPath}: ` +
      `flow "${existing.flowLabel}" (name="${existing.rawName}", device="${existing.rawDevice}") ` +
      `and flow "${planned.flowLabel}" (name="${planned.rawName}", device="${planned.rawDevice}") ` +
      `both normalize to the same filename. Rename one of them to avoid overwriting artifacts.`
  )
}

export function sanitizeArtifactFragment(value, { kind, context }) {
  const raw = String(value ?? "")
  const cleaned = raw
    .replace(/\0/g, "")
    .split(/[\\/]/)
    .filter((part) => part && part !== "." && part !== "..")
    .join("-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
  if (!cleaned) {
    throw new Error(`Invalid ${kind} "${raw}" for ${context}: cannot be normalized to a safe filename.`)
  }
  return cleaned
}

async function runFlow({ page, flow, baseUrl, shotsDir, deviceName, runtime, options, captureState }) {
  const rawScreenshotName = flow.screenshot?.name || flow.name || flow.slug
  if (!rawScreenshotName) {
    throw new Error(`Flow "${flow.label || "(unnamed)"}" must define screenshot.name or name.`)
  }
  const flowLabel = flow.label || "(unnamed)"
  const screenshotName = sanitizeArtifactFragment(rawScreenshotName, {
    kind: "flow name",
    context: `flow "${flowLabel}"`,
  })
  const safeDeviceName = sanitizeArtifactFragment(deviceName, {
    kind: "device name",
    context: `flow "${flowLabel}"`,
  })

  const url = resolveFlowUrl(baseUrl, flow.path)
  if (url) {
    await gotoWithViewport(page, url, flow, options.viewport)
  }

  if (flow.waitFor) {
    await page.waitForSelector(flow.waitFor, { timeout: getActionTimeout(flow) })
  }

  if (Array.isArray(flow.actions)) {
    for (const action of flow.actions) {
      const normalizedAction = action.type === "goto" && action.path
        ? { ...action, url: resolveFlowUrl(baseUrl, action.path) }
        : action
      await applyStatefulAction(page, normalizedAction, runtime, baseUrl, options)
    }
  }

  if (flow.settleMs) {
    await page.waitForTimeout(flow.settleMs)
  }

  if (options.validateOnly) {
    if (flow.screenshot?.selector) {
      await page.locator(flow.screenshot.selector).first().waitFor({ timeout: getActionTimeout(flow.screenshot) })
    }
    return null
  }

  if (Number.isFinite(captureState.maxScreenshots) && captureState.count >= captureState.maxScreenshots) {
    captureState.limitReached = true
    if (!captureState.limitLogged) {
      captureState.logger?.warn?.(
        `Limit reached: ${captureState.count}/${captureState.maxScreenshots} screenshots captured, skipping remaining.`
      )
      captureState.limitLogged = true
    }
    return null
  }

  const screenshotPath = path.join(shotsDir, `${screenshotName}-${safeDeviceName}.png`)
  const resolvedShotsDir = path.resolve(shotsDir)
  const resolvedScreenshotPath = path.resolve(screenshotPath)
  if (
    resolvedScreenshotPath !== resolvedShotsDir &&
    !resolvedScreenshotPath.startsWith(`${resolvedShotsDir}${path.sep}`)
  ) {
    throw new Error(`Screenshot path "${screenshotPath}" escapes shotsDir "${shotsDir}".`)
  }

  if (captureState.plannedPaths) {
    registerPlannedScreenshotPath({
      plannedPaths: captureState.plannedPaths,
      resolvedScreenshotPath,
      screenshotPath,
      rawScreenshotName,
      rawDeviceName: deviceName,
      flowLabel,
    })
  }
  await prepareScreenshot(page, flow, options)

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

  captureState.count += 1
  return screenshotPath
}

function buildResolvedFlows(flows) {
  return flows.length > 0
    ? flows
    : [
        {
          label: "Home - Mobile vs Desktop",
          name: "home",
          path: "/",
          waitFor: "body",
          settleMs: 200,
          screenshot: { fullPage: true },
        },
      ]
}

export async function runBrowserCleanup({ browser, server, logger, closeBrowser, stopServer }) {
  const close = closeBrowser || ((target) => target.close())
  const stop = stopServer || stopServerProcess
  if (browser) {
    try {
      await close(browser)
    } catch (err) {
      logger?.warn?.(`browser.close failed: ${err instanceof Error ? err.message : err}`)
    }
  }
  if (server?.proc) {
    try {
      await stop(server.proc, logger)
    } catch (err) {
      logger?.warn?.(`stopServerProcess failed: ${err instanceof Error ? err.message : err}`)
    }
  }
}

export async function runWithBrowser(options, context, work, runtime = {}) {
  const loadPlaywright = runtime.loadPlaywright || (() => import("playwright"))
  const ensureServerFn = runtime.ensureServer || ensureServer
  const cleanupFn = runtime.runBrowserCleanup || runBrowserCleanup
  const playwright = await loadPlaywright()
  const chromium = playwright.chromium
  const playwrightDevices = playwright.devices

  const baseUrl = options.baseUrl || context.baseUrl
  const timeoutMs = options.timeoutMs || context.timeoutMs || 120000
  const rootDir = context.rootDir
  const logger = context.logger || console
  const server = await ensureServerFn({
    baseUrl,
    timeoutMs,
    startCommand: options.startCommand,
    env: { ...process.env, ...(context.env || {}), ...(options.env || {}) },
    cwd: rootDir,
    logger,
    expectTitleIncludes: options.expectTitleIncludes ?? context.expectTitleIncludes,
    reuseExistingServer: options.reuseExistingServer === true,
  })

  let browser = null
  try {
    browser = await chromium.launch(options.launch || {})
    return await work({
      browser,
      playwrightDevices,
      logger,
      baseUrl: server.baseUrl || baseUrl,
    })
  } finally {
    await cleanupFn({ browser, server, logger })
  }
}

async function withBrowser(options, context, work) {
  return runWithBrowser(options, context, work)
}

export function createPlaywrightCaptureHarness(options = {}) {
  validatePlaywrightCaptureDefinition(options)
  const devices = Array.isArray(options.devices) && options.devices.length > 0 ? options.devices : DEFAULT_DEVICES
  const flows = Array.isArray(options.flows) ? options.flows : []

  return async function captureUx(context) {
    const shotsDir = context.shotsDir
    if (!shotsDir) {
      throw new Error("Capture context is missing shotsDir.")
    }

    fs.mkdirSync(shotsDir, { recursive: true })

    return withBrowser(options, context, async ({ browser, playwrightDevices, logger, baseUrl }) => {
      const groups = []
      const runtime = {}
      const captureState = {
        count: 0,
        maxScreenshots: options.maxScreenshots,
        limitReached: false,
        limitLogged: false,
        logger,
        plannedPaths: new Map(),
      }

      for (const flow of buildResolvedFlows(flows)) {
        if (!flow.label) {
          throw new Error("Each flow must include a label.")
        }

        const files = []

        for (const rawDevice of devices) {
          const device = resolveDevice(rawDevice, playwrightDevices, options.maxResolution, logger)
          const browserContext = await browser.newContext({
            ...device.contextOptions,
            viewport: device.viewport,
          })
          const page = await browserContext.newPage()

          try {
            await ensureViewport(page, device.viewport)
            const screenshotPath = await runFlow({
              page,
              flow,
              baseUrl,
              shotsDir,
              deviceName: device.name,
              runtime,
              options: {
                ...options,
                viewport: device.viewport,
                logger,
              },
              captureState,
            })
            if (screenshotPath) {
              files.push(screenshotPath)
            }
          } finally {
            await browserContext.close()
          }

          if (captureState.limitReached) {
            break
          }
        }

        if (files.length > 0) {
          groups.push({
            label: flow.label,
            files,
          })
        }

        if (captureState.limitReached) {
          break
        }
      }

      return groups
    })
  }
}

export function createPlaywrightFlowValidator(options = {}) {
  validatePlaywrightCaptureDefinition(options)
  const devices = Array.isArray(options.devices) && options.devices.length > 0 ? options.devices : DEFAULT_DEVICES
  const flows = Array.isArray(options.flows) ? options.flows : []

  return async function validateFlows(context) {
    return withBrowser(options, context, async ({ browser, playwrightDevices, logger, baseUrl }) => {
      const runtime = {}
      const results = []

      for (const flow of buildResolvedFlows(flows)) {
        for (const rawDevice of devices) {
          const device = resolveDevice(rawDevice, playwrightDevices, options.maxResolution, logger)
          const browserContext = await browser.newContext({
            ...device.contextOptions,
            viewport: device.viewport,
          })
          const page = await browserContext.newPage()

          try {
            await ensureViewport(page, device.viewport)
            await runFlow({
              page,
              flow,
              baseUrl,
              shotsDir: context.shotsDir || path.join(context.rootDir || process.cwd(), ".uxl", "shots"),
              deviceName: device.name,
              runtime,
              options: {
                ...options,
                validateOnly: true,
                viewport: device.viewport,
                logger,
              },
              captureState: { count: 0, maxScreenshots: undefined, logger },
            })
            results.push({
              flow: flow.name || flow.slug || flow.label,
              device: device.name,
              status: "ok",
            })
          } catch (error) {
            results.push({
              flow: flow.name || flow.slug || flow.label,
              device: device.name,
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            })
          } finally {
            await browserContext.close()
          }
        }
      }

      return results
    })
  }
}

export const defaultCaptureDevices = DEFAULT_DEVICES
export { buildServerProbeUrls, isServerReadyResponse }

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
          throw new Error(`Device "${device.name}" must set width/height or playwrightDevice.`)
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
        throw new Error(`Flow "${flow.label}" must define screenshot.name, name, or slug.`)
      }

      if (flow.actions !== undefined) {
        if (!Array.isArray(flow.actions)) {
          throw new Error(`Flow "${flow.label}" actions must be an array.`)
        }
        for (const action of flow.actions) {
          if (!action || typeof action !== "object") {
            throw new Error(`Flow "${flow.label}" contains a non-object action.`)
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
