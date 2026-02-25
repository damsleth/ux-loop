import fs from "fs"
import { assertFullFlowCoverage } from "../capture/flow-onboarding.mjs"
import { loadConfig } from "../config/load-config.mjs"
import { writeManifest } from "../manifest/write-manifest.mjs"
import { createPlaywrightCaptureHarness } from "../capture/playwright-harness.mjs"

function resolveCaptureExport(moduleExports) {
  if (typeof moduleExports.captureUx === "function") return moduleExports.captureUx
  if (typeof moduleExports.captureUi === "function") return moduleExports.captureUi
  throw new Error("Capture adapter must export captureUx(context).")
}

function ensureFilesExist(groups) {
  for (const group of groups) {
    for (const filePath of group.files) {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Capture adapter reported file not found: ${filePath}`)
      }
    }
  }
}

export async function runShots() {
  const config = await loadConfig()

  assertFullFlowCoverage(config)

  fs.mkdirSync(config.paths.artifactsDir, { recursive: true })
  fs.mkdirSync(config.paths.shotsDir, { recursive: true })
  fs.mkdirSync(config.paths.logsDir, { recursive: true })

  let capture
  if (config.capture.runner === "playwright") {
    if (config.capture.adapter) {
      const adapterModule = await import(config.capture.adapter)
      capture = resolveCaptureExport(adapterModule)
    } else {
      const playwrightConfig = config.capture.playwright || {}
      capture = createPlaywrightCaptureHarness({
        baseUrl: config.capture.baseUrl,
        timeoutMs: config.capture.timeoutMs,
        startCommand: playwrightConfig.startCommand,
        devices: playwrightConfig.devices,
        flows: playwrightConfig.flows,
        launch: playwrightConfig.launch,
        env: playwrightConfig.env,
      })
    }
  } else {
    const adapterModule = await import(config.capture.adapter)
    capture = resolveCaptureExport(adapterModule)
  }

  const groups = await capture({
    rootDir: config.paths.root,
    shotsDir: config.paths.shotsDir,
    baseUrl: config.capture.baseUrl,
    logger: console,
    env: { ...process.env, ...(config.capture.env || {}) },
    timeoutMs: config.capture.timeoutMs,
  })

  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error("Capture adapter must return a non-empty array of groups.")
  }

  ensureFilesExist(groups)
  const manifest = writeManifest(config.paths.manifestPath, groups)
  console.log(`Manifest written: ${config.paths.manifestPath} (${manifest.groups.length} groups)`)
}
