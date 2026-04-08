import fs from "fs"
import { assertFullFlowCoverage } from "../capture/flow-onboarding.mjs"
import { loadConfig } from "../config/load-config.mjs"
import { writeManifest } from "../manifest/write-manifest.mjs"
import { createPlaywrightCaptureHarness } from "../capture/playwright-harness.mjs"
import { createCommandLogger } from "../utils/command-logger.mjs"

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

export async function runShots(args = [], cwd = process.cwd(), runtime = {}) {
  if (args.length > 0) {
    throw new Error(`uxl shots does not accept arguments: ${args.join(" ")}`)
  }

  const load = runtime.loadConfig || loadConfig
  const loggerFactory = runtime.createCommandLogger || createCommandLogger
  const harnessFactory = runtime.createPlaywrightCaptureHarness || createPlaywrightCaptureHarness
  const config = await load(cwd)

  assertFullFlowCoverage(config)

  fs.mkdirSync(config.paths.artifactsDir, { recursive: true })
  fs.mkdirSync(config.paths.shotsDir, { recursive: true })
  fs.mkdirSync(config.paths.logsDir, { recursive: true })
  const logger = loggerFactory({
    scope: "shots",
    logsDir: config.paths.logsDir,
    echoToConsole: config.output.verbose,
  })
  logger.log(`Starting capture run in ${config.paths.root}`)
  logger.log(`Manifest output: ${config.paths.manifestPath}`)
  console.log("Capturing screenshots...")

  try {
    let capture
    if (config.capture.runner === "playwright") {
      if (config.capture.adapter) {
        const adapterModule = await import(config.capture.adapter)
        capture = resolveCaptureExport(adapterModule)
      } else {
        const playwrightConfig = config.capture.playwright || {}
        capture = harnessFactory({
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
      logger,
      env: { ...process.env, ...(config.capture.env || {}) },
      timeoutMs: config.capture.timeoutMs,
    })

    if (!Array.isArray(groups) || groups.length === 0) {
      throw new Error("Capture adapter must return a non-empty array of groups.")
    }

    ensureFilesExist(groups)
    const manifest = writeManifest(config.paths.manifestPath, groups)
    logger.log(`Manifest written: ${config.paths.manifestPath} (${manifest.groups.length} groups)`)
    console.log(`Capture complete. Manifest: ${config.paths.manifestPath}`)
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error))
    throw error
  }
}
