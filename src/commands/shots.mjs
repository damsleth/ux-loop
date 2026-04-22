import fs from "fs"
import { assertFullFlowCoverage } from "../capture/flow-onboarding.mjs"
import { createPlaywrightCaptureHarness } from "../capture/playwright-harness.mjs"
import { loadConfig } from "../config/load-config.mjs"
import { writeManifest } from "../manifest/write-manifest.mjs"
import { writeJsonArtifact } from "../utils/artifacts.mjs"
import { createCommandLogger } from "../utils/command-logger.mjs"
import { parseCliOptions } from "../utils/parse-cli-options.mjs"

const SHOTS_BOOLEAN_OPTIONS = new Set(["no-limits"])

export const SHOTS_OPTION_NAMES = new Set(SHOTS_BOOLEAN_OPTIONS)

function parseShotsArgs(args) {
  const parsed = parseCliOptions(args, {
    valueOptions: [],
    booleanOptions: SHOTS_BOOLEAN_OPTIONS,
  })
  return {
    noLimits: parsed["no-limits"] === true,
  }
}

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

function countScreenshots(groups) {
  return groups.reduce((total, group) => total + group.files.length, 0)
}

export async function runShots(args = [], cwd = process.cwd(), runtime = {}) {
  const startedAt = Date.now()
  const overrides = parseShotsArgs(args)
  const load = runtime.loadConfig || loadConfig
  const loggerFactory = runtime.createCommandLogger || createCommandLogger
  const harnessFactory = runtime.createPlaywrightCaptureHarness || createPlaywrightCaptureHarness
  const writeArtifact = runtime.writeJsonArtifact || writeJsonArtifact
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
          expectTitleIncludes: config.capture.expectTitleIncludes,
          startCommand: playwrightConfig.startCommand,
          devices: playwrightConfig.devices,
          flows: playwrightConfig.flows,
          launch: playwrightConfig.launch,
          env: playwrightConfig.env,
          actionRetries: playwrightConfig.actionRetries,
          actionRetryBackoffMs: playwrightConfig.actionRetryBackoffMs,
          screenshotWaitUntil: playwrightConfig.screenshotWaitUntil,
          stabilizationDelayMs: playwrightConfig.stabilizationDelayMs,
          maxScreenshots: overrides.noLimits ? undefined : config.limits?.maxScreenshots,
          maxResolution: overrides.noLimits ? undefined : config.limits?.maxResolution,
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
      expectTitleIncludes: config.capture.expectTitleIncludes,
    })

    if (!Array.isArray(groups) || groups.length === 0) {
      throw new Error("Capture adapter must return a non-empty array of groups.")
    }

    ensureFilesExist(groups)
    const manifest = writeManifest(config.paths.manifestPath, groups)
    const screenshotCount = countScreenshots(manifest.groups)
    const reportJsonPath = writeArtifact({
      dir: config.paths.reportsDir || `${config.paths.root}/.uxl/reports`,
      prefix: "uxl_report",
      payload: {
        timestamp: new Date().toISOString(),
        command: "shots",
        status: "success",
        duration_ms: Date.now() - startedAt,
        model: null,
        scope: null,
        iteration: 1,
        steps: [
          {
            step: "shots",
            duration_ms: Date.now() - startedAt,
            screenshots: screenshotCount,
            groups: manifest.groups.length,
          },
        ],
      },
    })
    logger.log(`Manifest written: ${config.paths.manifestPath} (${manifest.groups.length} groups)`)
    logger.log(`Structured report written: ${reportJsonPath}`)
    console.log(`Capture complete. Manifest: ${config.paths.manifestPath}`)
    return {
      status: "success",
      manifestPath: config.paths.manifestPath,
      reportJsonPath,
      screenshots: screenshotCount,
      groups: manifest.groups.length,
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error))
    throw error
  }
}
