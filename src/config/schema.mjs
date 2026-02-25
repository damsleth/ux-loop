import path from "path"

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

export function normalizeConfig(input, configFilePath = path.resolve(process.cwd(), "uxl.config.mjs")) {
  const root = resolvePath(process.cwd(), input?.paths?.root || DEFAULTS.paths.root)
  const merged = mergeObjects(DEFAULTS, input || {})

  validateEnum(merged.capture.runner, ["playwright", "custom"], "capture.runner")

  if (merged.capture.runner === "custom") {
    if (!merged.capture?.adapter || typeof merged.capture.adapter !== "string") {
      throw new Error(`capture.adapter is required for capture.runner=custom in ${configFilePath}.`)
    }
  }

  if (merged.capture.runner === "playwright" && merged.capture.playwright && !isObject(merged.capture.playwright)) {
    throw new Error(`capture.playwright must be an object in ${configFilePath}.`)
  }

  validateEnum(merged.review.runner, ["codex", "openai"], "review.runner")
  validateEnum(merged.implement.runner, ["codex"], "implement.runner")
  validateEnum(merged.implement.target, ["current", "branch", "worktree"], "implement.target")

  merged.paths.root = root
  merged.paths.artifactsDir = resolvePath(root, merged.paths.artifactsDir)
  merged.paths.shotsDir = resolvePath(root, merged.paths.shotsDir)
  merged.paths.manifestPath = resolvePath(root, merged.paths.manifestPath)
  merged.paths.reportPath = resolvePath(root, merged.paths.reportPath)
  merged.paths.logsDir = resolvePath(root, merged.paths.logsDir)

  if (merged.capture.adapter) {
    merged.capture.adapter = resolvePath(root, merged.capture.adapter)
  }
  merged.implement.autoCommit = false

  return merged
}
