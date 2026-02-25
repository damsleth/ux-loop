import path from "path"
import { evaluateFlowCoverage } from "../capture/flow-onboarding.mjs"

const DEFAULTS = {
  paths: {
    root: process.cwd(),
    artifactsDir: ".uxl",
    shotsDir: ".uxl/shots",
    manifestPath: ".uxl/shots/manifest.json",
    reportPath: ".uxl/report.md",
    logsDir: ".uxl/logs",
  },
  capture: {
    runner: "playwright",
    adapter: undefined,
    baseUrl: undefined,
    env: {},
    timeoutMs: 120000,
    onboarding: {
      status: "pending",
    },
    flowInventory: [],
    flowMapping: {},
    playwright: {
      startCommand: "dev",
      devices: undefined,
      flows: undefined,
      launch: undefined,
      env: {},
    },
  },
  review: {
    runner: "codex",
    model: undefined,
    systemPrompt: undefined,
    codex: {
      bin: "codex",
    },
    openai: {
      apiKeyEnv: "OPENAI_API_KEY",
    },
  },
  implement: {
    runner: "codex",
    target: "worktree",
    branchNameTemplate: "uxl-{timestamp}",
    worktreePathTemplate: "{repoParent}/{repoName}-{branchName}",
    autoCommit: false,
    codex: {
      bin: "codex",
    },
    model: undefined,
  },
  run: {
    runShots: true,
    runReview: true,
    runImplement: true,
    stopOnError: true,
  },
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function mergeObjects(base, overrides) {
  if (!isObject(overrides)) return { ...base }
  const merged = { ...base }
  for (const [key, value] of Object.entries(overrides)) {
    if (isObject(value) && isObject(base[key])) {
      merged[key] = mergeObjects(base[key], value)
    } else {
      merged[key] = value
    }
  }
  return merged
}

function resolvePath(root, value) {
  if (!value) return value
  if (path.isAbsolute(value)) return value
  return path.resolve(root, value)
}

function validateEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`Invalid ${label}: "${value}". Allowed: ${allowed.join(", ")}.`)
  }
}

function validateFlowInventory(flowInventory, configFilePath) {
  if (!Array.isArray(flowInventory)) {
    throw new Error(`capture.flowInventory must be an array in ${configFilePath}.`)
  }

  const ids = new Set()
  for (const entry of flowInventory) {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Each capture.flowInventory entry must be an object in ${configFilePath}.`)
    }

    if (typeof entry.id !== "string" || !entry.id.trim()) {
      throw new Error(`Each flow inventory entry must include a non-empty string id in ${configFilePath}.`)
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) {
      throw new Error(`Flow inventory id "${entry.id}" must be slug-case in ${configFilePath}.`)
    }

    if (ids.has(entry.id)) {
      throw new Error(`Duplicate flow inventory id "${entry.id}" in ${configFilePath}.`)
    }
    ids.add(entry.id)

    if (typeof entry.label !== "string" || !entry.label.trim()) {
      throw new Error(`Flow inventory entry "${entry.id}" must include a non-empty label in ${configFilePath}.`)
    }

    if (entry.path !== undefined && (typeof entry.path !== "string" || !entry.path.trim())) {
      throw new Error(`Flow inventory entry "${entry.id}" path must be a non-empty string when provided in ${configFilePath}.`)
    }

    if (entry.required !== undefined && typeof entry.required !== "boolean") {
      throw new Error(`Flow inventory entry "${entry.id}" required must be boolean in ${configFilePath}.`)
    }
  }
}

function validateFlowMapping(flowMapping, inventoryIds, configFilePath) {
  if (!isObject(flowMapping)) {
    throw new Error(`capture.flowMapping must be an object in ${configFilePath}.`)
  }

  for (const [inventoryId, mappedFlows] of Object.entries(flowMapping)) {
    if (!inventoryIds.has(inventoryId)) {
      throw new Error(`capture.flowMapping references unknown inventory id "${inventoryId}" in ${configFilePath}.`)
    }

    if (!Array.isArray(mappedFlows) || mappedFlows.length === 0) {
      throw new Error(
        `capture.flowMapping["${inventoryId}"] must be a non-empty array of capture flow names in ${configFilePath}.`
      )
    }

    for (const flowName of mappedFlows) {
      if (typeof flowName !== "string" || !flowName.trim()) {
        throw new Error(`capture.flowMapping["${inventoryId}"] contains an invalid flow name in ${configFilePath}.`)
      }
    }
  }
}

function validatePlaywrightFlowNames(merged, configFilePath) {
  const flows = merged.capture.playwright?.flows
  if (flows === undefined) return new Set()

  if (!Array.isArray(flows)) {
    throw new Error(`capture.playwright.flows must be an array in ${configFilePath}.`)
  }

  const flowNames = new Set()
  for (const flow of flows) {
    if (!flow || typeof flow !== "object") {
      throw new Error(`Each capture.playwright.flows entry must be an object in ${configFilePath}.`)
    }

    if (typeof flow.name !== "string" || !flow.name.trim()) {
      throw new Error("Each capture.playwright flow must define a non-empty string `name` for flow mapping.")
    }

    if (flowNames.has(flow.name)) {
      throw new Error(`Duplicate capture.playwright flow name "${flow.name}" in ${configFilePath}.`)
    }

    flowNames.add(flow.name)
  }

  return flowNames
}

export function normalizeConfig(input, configFilePath = path.resolve(process.cwd(), "uxl.config.mjs")) {
  const root = resolvePath(process.cwd(), input?.paths?.root || DEFAULTS.paths.root)
  const merged = mergeObjects(DEFAULTS, input || {})

  validateEnum(merged.capture.runner, ["playwright", "custom"], "capture.runner")

  if (merged.capture.runner === "custom") {
    if (!merged.capture?.adapter || typeof merged.capture.adapter !== "string") {
      throw new Error(`capture.adapter is required for capture.runner=custom in ${configFilePath}.`)
    }
  }

  if (merged.capture.runner === "playwright" && merged.capture.playwright !== undefined && !isObject(merged.capture.playwright)) {
    throw new Error(`capture.playwright must be an object in ${configFilePath}.`)
  }

  validateEnum(merged.review.runner, ["codex", "openai"], "review.runner")
  validateEnum(merged.implement.runner, ["codex"], "implement.runner")
  validateEnum(merged.implement.target, ["current", "branch", "worktree"], "implement.target")

  if (!isObject(merged.capture.onboarding)) {
    throw new Error(`capture.onboarding must be an object in ${configFilePath}.`)
  }
  validateEnum(merged.capture.onboarding.status, ["pending", "complete"], "capture.onboarding.status")

  validateFlowInventory(merged.capture.flowInventory, configFilePath)
  merged.capture.flowInventory = merged.capture.flowInventory.map((entry) => ({
    ...entry,
    required: entry.required !== false,
  }))

  const inventoryIds = new Set(merged.capture.flowInventory.map((entry) => entry.id))
  validateFlowMapping(merged.capture.flowMapping, inventoryIds, configFilePath)

  const flowNames = validatePlaywrightFlowNames(merged, configFilePath)
  if (flowNames.size > 0) {
    for (const [inventoryId, mappedNames] of Object.entries(merged.capture.flowMapping)) {
      for (const flowName of mappedNames) {
        if (!flowNames.has(flowName)) {
          throw new Error(
            `capture.flowMapping["${inventoryId}"] references unknown capture.playwright flow name "${flowName}" in ${configFilePath}.`
          )
        }
      }
    }
  }

  if (merged.capture.onboarding.status === "complete") {
    const coverage = evaluateFlowCoverage({
      flowInventory: merged.capture.flowInventory,
      flowMapping: merged.capture.flowMapping,
      playwrightFlows: merged.capture.playwright?.flows,
    })

    if (!coverage.complete) {
      throw new Error(
        `capture.onboarding.status cannot be "complete" until required flow inventory coverage is 100% in ${configFilePath}.`
      )
    }
  }

  merged.paths.root = root
  merged.paths.artifactsDir = resolvePath(root, merged.paths.artifactsDir)
  merged.paths.shotsDir = resolvePath(root, merged.paths.shotsDir)
  merged.paths.manifestPath = resolvePath(root, merged.paths.manifestPath)
  merged.paths.reportPath = resolvePath(root, merged.paths.reportPath)
  merged.paths.logsDir = resolvePath(root, merged.paths.logsDir)

  if (merged.capture.adapter) {
    merged.capture.adapter = resolvePath(root, merged.capture.adapter)
  }

  return merged
}
