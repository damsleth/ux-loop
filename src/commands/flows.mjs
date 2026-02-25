import readline from "node:readline/promises"
import {
  buildCoverageErrorMessage,
  evaluateFlowCoverage,
  importPlaywrightFlowSuggestions,
  mergeImportedSuggestions,
  slugify,
} from "../capture/flow-onboarding.mjs"
import { loadRawConfig, writeConfigFile } from "../config/config-file.mjs"
import { normalizeConfig } from "../config/schema.mjs"

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function parseFlags(args) {
  const result = { _: [] }

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (!token.startsWith("--")) {
      result._.push(token)
      continue
    }

    if (token.includes("=")) {
      const [key, ...rest] = token.slice(2).split("=")
      result[key] = rest.join("=")
      continue
    }

    const key = token.slice(2)
    const next = args[i + 1]
    if (next && !next.startsWith("--")) {
      result[key] = next
      i += 1
    } else {
      result[key] = true
    }
  }

  return result
}

function ensureCaptureShape(rawConfig) {
  if (!isObject(rawConfig.capture)) rawConfig.capture = {}
  if (!isObject(rawConfig.capture.onboarding)) rawConfig.capture.onboarding = { status: "pending" }
  if (!Array.isArray(rawConfig.capture.flowInventory)) rawConfig.capture.flowInventory = []
  if (!isObject(rawConfig.capture.flowMapping)) rawConfig.capture.flowMapping = {}
  if (!isObject(rawConfig.capture.playwright)) rawConfig.capture.playwright = {}
  if (!Array.isArray(rawConfig.capture.playwright.flows)) rawConfig.capture.playwright.flows = []
}

function syncOnboardingStatus(captureConfig) {
  const report = evaluateFlowCoverage({
    flowInventory: captureConfig.flowInventory,
    flowMapping: captureConfig.flowMapping,
    playwrightFlows: captureConfig.playwright?.flows,
  })
  captureConfig.onboarding.status = report.complete ? "complete" : "pending"
  return report
}

function printCoverageSummary(report) {
  const machine = {
    complete: report.complete,
    coveragePercent: report.coveragePercent,
    mappedRequired: report.mappedRequired,
    totalRequired: report.totalRequired,
    unmappedRequiredIds: report.unmappedRequiredIds,
    invalidMappedFlowNames: report.invalidMappedFlowNames,
    unknownInventoryMappingIds: report.unknownInventoryMappingIds,
  }

  console.log(JSON.stringify(machine))
  console.log(
    `Coverage: ${report.coveragePercent}% (${report.mappedRequired}/${report.totalRequired} required flows mapped)`
  )

  if (report.unmappedRequiredIds.length > 0) {
    console.log(`Unmapped required IDs: ${report.unmappedRequiredIds.join(", ")}`)
  }

  if (report.invalidMappedFlowNames.length > 0) {
    const invalid = report.invalidMappedFlowNames
      .map((entry) => `${entry.inventoryId} -> ${entry.flowNames.join(", ")}`)
      .join("; ")
    console.log(`Invalid mapped flow names: ${invalid}`)
  }

  if (report.unknownInventoryMappingIds.length > 0) {
    console.log(`Unknown mapping IDs: ${report.unknownInventoryMappingIds.join(", ")}`)
  }

  console.log(`Complete: ${report.complete ? "yes" : "no"}`)
}

function ensureRequiredValue(value, flagName) {
  if (!value || typeof value !== "string") {
    throw new Error(`Missing required flag --${flagName}.`)
  }
  return value
}

async function runList(cwd) {
  const { configPath, raw } = await loadRawConfig(cwd)
  const normalized = normalizeConfig(
    {
      ...raw,
      paths: {
        ...(raw.paths || {}),
        root: raw?.paths?.root || cwd,
      },
    },
    configPath
  )

  const flowNames = new Set(
    (normalized.capture.playwright?.flows || []).map((flow) => flow.name).filter(Boolean)
  )

  for (const entry of normalized.capture.flowInventory) {
    const mapped = normalized.capture.flowMapping[entry.id] || []
    const status =
      mapped.length === 0
        ? "unmapped"
        : mapped.every((name) => flowNames.has(name))
          ? "mapped"
          : "invalid"

    console.log(
      `${entry.id}\t${status}\trequired=${entry.required ? "true" : "false"}\tmapped=[${mapped.join(", ")}]\tlabel=${entry.label}`
    )
  }
}

async function runAdd(cwd, parsedFlags) {
  const idValue = parsedFlags.id ? slugify(parsedFlags.id) : ""
  const id = ensureRequiredValue(idValue, "id")
  const label = ensureRequiredValue(parsedFlags.label, "label")
  const flowName = parsedFlags.to ? String(parsedFlags.to) : id

  const { configPath, raw } = await loadRawConfig(cwd)
  ensureCaptureShape(raw)

  if (raw.capture.flowInventory.some((entry) => entry.id === id)) {
    throw new Error(`Flow inventory id already exists: ${id}`)
  }

  const nextPath = typeof parsedFlags.path === "string" ? parsedFlags.path : "/"

  raw.capture.flowInventory.push({
    id,
    label,
    path: nextPath,
    required: true,
  })

  const existingFlow = raw.capture.playwright.flows.find((flow) => flow.name === flowName)
  if (!existingFlow) {
    raw.capture.playwright.flows.push({
      label,
      name: flowName,
      path: nextPath,
      waitFor: "body",
      settleMs: 200,
      screenshot: { fullPage: true },
    })
  }

  raw.capture.flowMapping[id] = [flowName]
  const report = syncOnboardingStatus(raw.capture)

  writeConfigFile(configPath, raw)
  console.log(`Added flow inventory: ${id}`)
  printCoverageSummary(report)
}

async function runMap(cwd, parsedFlags) {
  const id = ensureRequiredValue(parsedFlags.id, "id")
  const mappedTo = ensureRequiredValue(parsedFlags.to, "to")

  const { configPath, raw } = await loadRawConfig(cwd)
  ensureCaptureShape(raw)

  const inventoryEntry = raw.capture.flowInventory.find((entry) => entry.id === id)
  if (!inventoryEntry) {
    throw new Error(`Unknown flow inventory id: ${id}`)
  }

  raw.capture.flowMapping[id] = mappedTo
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  const report = syncOnboardingStatus(raw.capture)
  writeConfigFile(configPath, raw)

  console.log(`Updated mapping: ${id} -> [${raw.capture.flowMapping[id].join(", ")}]`)
  printCoverageSummary(report)
}

async function runCheck(cwd) {
  const { configPath, raw } = await loadRawConfig(cwd)
  const normalized = normalizeConfig(
    {
      ...raw,
      paths: {
        ...(raw.paths || {}),
        root: raw?.paths?.root || cwd,
      },
    },
    configPath
  )

  const report = evaluateFlowCoverage({
    flowInventory: normalized.capture.flowInventory,
    flowMapping: normalized.capture.flowMapping,
    playwrightFlows: normalized.capture.playwright?.flows,
  })

  printCoverageSummary(report)
  if (!report.complete) {
    throw new Error(buildCoverageErrorMessage(report))
  }
}

function createPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return {
    ask: async (question) => rl.question(question),
    close: async () => rl.close(),
  }
}

async function runImportPlaywright(cwd, parsedFlags, runtime = {}) {
  const imported = importPlaywrightFlowSuggestions(cwd)
  if (imported.inventory.length === 0) {
    console.log("No Playwright tests were detected for import.")
    return
  }

  console.log(`Detected ${imported.files.length} Playwright test file(s).`)
  console.log(`Prepared ${imported.inventory.length} suggested flow inventory entries.`)

  let confirmed = Boolean(parsedFlags.yes)

  const prompt = runtime.prompt
    ? { ask: runtime.prompt, close: async () => {} }
    : createPrompt()

  if (!confirmed) {
    if (!process.stdin.isTTY && !runtime.prompt) {
      throw new Error("import-playwright requires explicit confirmation. Re-run with --yes.")
    }

    const answer = await prompt.ask("Type yes to apply imported suggestions: ")
    confirmed = String(answer || "").trim().toLowerCase() === "yes"
  }

  await prompt.close()

  if (!confirmed) {
    console.log("Import aborted.")
    return
  }

  const { configPath, raw } = await loadRawConfig(cwd)
  ensureCaptureShape(raw)

  const merged = mergeImportedSuggestions({
    flowInventory: raw.capture.flowInventory,
    flowMapping: raw.capture.flowMapping,
    playwrightFlows: raw.capture.playwright.flows,
    imported,
  })

  raw.capture.flowInventory = merged.flowInventory
  raw.capture.flowMapping = merged.flowMapping
  raw.capture.playwright.flows = merged.playwrightFlows
  raw.capture.onboarding.status = "pending"

  writeConfigFile(configPath, raw)
  console.log(`Imported ${merged.added} flow inventory entries (onboarding remains pending).`)
}

export async function runFlows(args = [], cwd = process.cwd(), runtime = {}) {
  const parsed = parseFlags(args)
  const [subcommand] = parsed._

  if (!subcommand) {
    throw new Error("Missing flows subcommand. Use: list, add, map, check, import-playwright.")
  }

  if (subcommand === "list") {
    await runList(cwd)
    return
  }

  if (subcommand === "add") {
    await runAdd(cwd, parsed)
    return
  }

  if (subcommand === "map") {
    await runMap(cwd, parsed)
    return
  }

  if (subcommand === "check") {
    await runCheck(cwd)
    return
  }

  if (subcommand === "import-playwright") {
    await runImportPlaywright(cwd, parsed, runtime)
    return
  }

  throw new Error(`Unknown flows subcommand: ${subcommand}`)
}
