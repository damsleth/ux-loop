import fs from "fs"
import path from "path"
import readline from "node:readline/promises"
import {
  buildFlowScaffold,
  detectPlaywrightInstalled,
  evaluateFlowCoverage,
  readPlaywrightConfigSnapshot,
} from "../capture/flow-onboarding.mjs"
import { derivePortFromCwd } from "../utils/derive-port.mjs"

const DEFAULT_PACKAGE_SCRIPTS = {
  "uxl:init": "uxl init",
  "uxl:flows": "uxl flows check",
  "uxl:shots": "uxl shots",
  "uxl:review": "uxl review",
  "uxl:implement": "uxl implement",
  "uxl:diff": "uxl diff",
  "uxl:apply": "uxl apply",
  "uxl:rollback": "uxl rollback",
  "uxl:report": "uxl report",
  "uxl:run": "uxl run",
}

function parseInitArgs(args) {
  const flags = new Set(args)
  const presetArg = args.find((arg) => arg.startsWith("--preset="))
  const preset = presetArg ? presetArg.slice("--preset=".length) : "playwright-vite"

  return {
    force: flags.has("--force"),
    nonInteractive: flags.has("--non-interactive"),
    preset,
  }
}

function writeFileGuarded(filePath, content, force) {
  if (fs.existsSync(filePath) && !force) {
    throw new Error(`File already exists: ${filePath}. Use --force to overwrite.`)
  }
  fs.writeFileSync(filePath, content, "utf8")
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch (error) {
    throw new Error(
      `Could not parse JSON file at ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function ensurePackageScripts(cwd) {
  const packageJsonPath = path.join(cwd, "package.json")

  let packageJson
  let packageJsonCreated = false
  if (fs.existsSync(packageJsonPath)) {
    packageJson = readJsonFile(packageJsonPath)
  } else {
    packageJson = {
      name: path.basename(cwd),
      private: true,
    }
    packageJsonCreated = true
  }

  if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) {
    throw new Error(`package.json at ${packageJsonPath} must contain a JSON object.`)
  }

  if (!packageJson.scripts || typeof packageJson.scripts !== "object" || Array.isArray(packageJson.scripts)) {
    packageJson.scripts = {}
  }

  const scriptsAdded = []
  for (const [scriptName, scriptCommand] of Object.entries(DEFAULT_PACKAGE_SCRIPTS)) {
    if (packageJson.scripts[scriptName] === undefined) {
      packageJson.scripts[scriptName] = scriptCommand
      scriptsAdded.push(scriptName)
    }
  }

  if (packageJsonCreated || scriptsAdded.length > 0) {
    fs.writeFileSync(`${packageJsonPath}`, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8")
  }

  return {
    packageJsonPath,
    packageJsonCreated,
    scriptsAdded,
  }
}

function ensureGitignoreEntries(cwd) {
  const gitignorePath = path.join(cwd, ".gitignore")
  const requiredEntries = [".uxl/diffs/", ".uxl/snapshots/", ".uxl/reports/"]
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : ""
  const lines = existing.split(/\r?\n/).filter(Boolean)
  let updated = existing
  const added = []

  for (const entry of requiredEntries) {
    if (!lines.includes(entry)) {
      updated = `${updated}${updated.endsWith("\n") || !updated ? "" : "\n"}${entry}\n`
      added.push(entry)
    }
  }

  if (added.length > 0 || !fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, updated, "utf8")
  }

  return added
}

function extractPortFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null
  try {
    const parsed = new URL(rawUrl)
    if (parsed.port) {
      const port = Number(parsed.port)
      return Number.isFinite(port) ? port : null
    }
  } catch {
    return null
  }
  return null
}

function extractPortFromCommand(parsedCommand) {
  if (!parsedCommand || !Array.isArray(parsedCommand.args)) return null
  const args = parsedCommand.args
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--port" && i + 1 < args.length) {
      const port = Number(args[i + 1])
      if (Number.isFinite(port)) return port
    }
    const inline = typeof args[i] === "string" ? args[i].match(/^--port=(\d+)$/) : null
    if (inline) return Number(inline[1])
  }
  return null
}

function extractPortFromCommandEnv(parsedCommand) {
  const env = parsedCommand?.env
  if (!env || typeof env !== "object") return null
  const raw = env.PORT
  if (raw === undefined || raw === null) return null
  const port = Number(raw)
  return Number.isFinite(port) ? port : null
}

function buildDefaultStartCommand(port) {
  return {
    command: "npm",
    args: ["run", "dev", "--", "--port", String(port)],
  }
}

function serializeConfig(config, baseUrlFallback) {
  const token = "__UXL_BASE_URL_TOKEN__"
  const withToken = {
    ...config,
    capture: {
      ...config.capture,
      baseUrl: token,
    },
  }

  const json = JSON.stringify(withToken, null, 2).replace(
    `"${token}"`,
    `process.env.UI_REVIEW_BASE_URL || ${JSON.stringify(baseUrlFallback)}`
  )

  return `import { defineUxlConfig } from "@damsleth/ux-loop"

export default defineUxlConfig(${json})
`
}

function createDefaultPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return {
    ask: async (message) => rl.question(message),
    close: async () => rl.close(),
  }
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise
  }

  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
}

function tokenizeCommand(input) {
  const parts = []
  let token = ""
  let quote = null
  let escaping = false

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]

    if (escaping) {
      token += ch
      escaping = false
      continue
    }

    if (ch === "\\") {
      escaping = true
      continue
    }

    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        token += ch
      }
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }

    if (/\s/.test(ch)) {
      if (token) {
        parts.push(token)
        token = ""
      }
      continue
    }

    token += ch
  }

  if (escaping) {
    token += "\\"
  }
  if (token) {
    parts.push(token)
  }
  return parts
}

const ENV_ASSIGNMENT_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/

export function splitCommand(commandText) {
  const input = String(commandText || "").trim()
  if (!input) return null

  const parts = tokenizeCommand(input)
  if (parts.length === 0) return null

  const env = {}
  let index = 0
  while (index < parts.length) {
    const match = ENV_ASSIGNMENT_RE.exec(parts[index])
    if (!match) break
    env[match[1]] = match[2]
    index += 1
  }

  if (index >= parts.length) return null

  const [command, ...args] = parts.slice(index)
  const result = { command, args }
  if (Object.keys(env).length > 0) {
    result.env = env
  }
  return result
}

export async function runInit(args = [], cwd = process.cwd(), runtime = {}) {
  const { force, nonInteractive, preset } = parseInitArgs(args)
  if (preset !== "playwright-vite") {
    throw new Error(`Unsupported preset "${preset}". Supported: playwright-vite`)
  }

  const logger = runtime.logger || console
  const isInteractive =
    runtime.isInteractive !== undefined
      ? Boolean(runtime.isInteractive)
      : !nonInteractive && Boolean(process.stdin.isTTY)

  const configPath = path.join(cwd, "uxl.config.mjs")
  const promptTimeoutMs = Number.isFinite(runtime.promptTimeoutMs) ? runtime.promptTimeoutMs : 60000
  let promptRuntime = runtime.prompt ? { ask: runtime.prompt, close: async () => {} } : null
  const ask = async (message) => {
    if (!promptRuntime) {
      promptRuntime = createDefaultPrompt()
    }
    return withTimeout(promptRuntime.ask(message), promptTimeoutMs, `Init prompt timed out after ${promptTimeoutMs}ms.`)
  }

  try {
    const isPlaywrightInstalled = (runtime.detectPlaywrightInstalled || detectPlaywrightInstalled)(cwd)
    let playwrightInstalled = isPlaywrightInstalled

    if (!playwrightInstalled && isInteractive) {
      logger.log("Playwright was not detected in this project.")
      logger.log("Install it with: npm i -D playwright")

      while (!playwrightInstalled) {
        const answer = await ask(
          "Press Enter after installing Playwright (or type skip to continue with pending onboarding): "
        )

        if (String(answer || "").trim().toLowerCase() === "skip") {
          break
        }

        playwrightInstalled = (runtime.detectPlaywrightInstalled || detectPlaywrightInstalled)(cwd)
        if (!playwrightInstalled) {
          logger.log("Playwright is still not detected.")
        }
      }
    }

    const scaffold = (runtime.buildFlowScaffold || buildFlowScaffold)(cwd)
    const playwrightConfig = (runtime.readPlaywrightConfigSnapshot || readPlaywrightConfigSnapshot)(cwd)

    const derivedPort = (runtime.derivePortFromCwd || derivePortFromCwd)(cwd)

    let configuredStartCommand = null
    if (playwrightConfig?.webServerCommand) {
      configuredStartCommand = splitCommand(playwrightConfig.webServerCommand)
    }

    const playwrightBaseUrlPort = extractPortFromUrl(playwrightConfig?.baseUrl)
    const playwrightCommandPort = extractPortFromCommand(configuredStartCommand)
    const playwrightCommandEnvPort = extractPortFromCommandEnv(configuredStartCommand)

    let portSource = null
    let detectedPort = null
    if (playwrightBaseUrlPort) {
      detectedPort = playwrightBaseUrlPort
      portSource = "playwright-baseurl"
    } else if (playwrightCommandPort) {
      detectedPort = playwrightCommandPort
      portSource = "webserver-args"
    } else if (playwrightCommandEnvPort) {
      detectedPort = playwrightCommandEnvPort
      portSource = "webserver-env"
    }

    const hasPreservedCommand = Boolean(configuredStartCommand)
    let effectivePort
    if (detectedPort) {
      effectivePort = detectedPort
    } else if (hasPreservedCommand) {
      effectivePort = 5173
      portSource = "framework-default"
    } else {
      effectivePort = derivedPort
      portSource = "derived-fallback"
    }
    const configuredBaseUrl = playwrightConfig?.baseUrl || `http://127.0.0.1:${effectivePort}`
    if (!configuredStartCommand) {
      configuredStartCommand = buildDefaultStartCommand(effectivePort)
    }

    if (playwrightConfig?.configPath) {
      logger.log(`Detected Playwright config: ${playwrightConfig.configPath}`)
    }
    const portSourceMessages = {
      "playwright-baseurl": `using port ${effectivePort} from Playwright baseURL`,
      "webserver-args": `using port ${effectivePort} from Playwright webServer command args`,
      "webserver-env": `using port ${effectivePort} from Playwright webServer env assignment (PORT=${effectivePort})`,
      "framework-default": `no explicit port found in Playwright webServer command; using framework default ${effectivePort}. Review capture.baseUrl if your dev server starts elsewhere.`,
      "derived-fallback": `using repo-unique capture port ${effectivePort} (derived from "${path.basename(cwd)}")`,
    }
    if (portSourceMessages[portSource]) {
      logger.log(portSourceMessages[portSource])
    }
    if (detectedPort && detectedPort !== derivedPort) {
      logger.log(
        `Keeping Playwright-detected port ${detectedPort}; derived repo-unique port would have been ${derivedPort}.`
      )
    }

    let onboardingStatus = "pending"
    if (isInteractive) {
      logger.log(
        `Prepared ${scaffold.inventory.length} flow inventory entries and ${scaffold.flows.length} capture flows (${scaffold.source}).`
      )

      const completionAnswer = await ask(
        "Type yes to mark this as a full mapping of all required user flows: "
      )

      if (String(completionAnswer || "").trim().toLowerCase() === "yes") {
        const coverage = evaluateFlowCoverage({
          flowInventory: scaffold.inventory,
          flowMapping: scaffold.flowMapping,
          playwrightFlows: scaffold.flows,
        })
        onboardingStatus = coverage.complete ? "complete" : "pending"
        if (!coverage.complete) {
          logger.log("Coverage is not complete yet; onboarding remains pending.")
        }
      }
    }

    const configObject = {
      capture: {
        runner: "playwright",
        timeoutMs: 120000,
        onboarding: {
          status: onboardingStatus,
        },
        flowInventory: scaffold.inventory,
        flowMapping: scaffold.flowMapping,
        playwright: {
          startCommand: configuredStartCommand,
          devices: [
            { name: "mobile", width: 390, height: 844 },
            { name: "desktop", width: 1280, height: 800 },
          ],
          flows: scaffold.flows,
        },
      },
      review: {
        runner: "codex",
      },
      implement: {
        target: "worktree",
      },
    }

    const warnings = []
    if (!playwrightInstalled) {
      warnings.push("Playwright is not installed yet. Install with `npm i -D playwright`.")
    }
    if (onboardingStatus !== "complete") {
      warnings.push("Flow onboarding is pending. Complete mapping with `uxl flows check` and `uxl flows map`.")
    }

    writeFileGuarded(configPath, serializeConfig(configObject, configuredBaseUrl), force)
    const packageScripts = ensurePackageScripts(cwd)
    const gitignoreEntriesAdded = ensureGitignoreEntries(cwd)
    if (packageScripts.scriptsAdded.length > 0) {
      logger.log(`Added package scripts: ${packageScripts.scriptsAdded.join(", ")}`)
    }
    if (gitignoreEntriesAdded.length > 0) {
      logger.log(`Updated .gitignore: ${gitignoreEntriesAdded.join(", ")}`)
    }

    return {
      configPath,
      onboardingStatus,
      playwrightInstalled,
      warnings,
      packageScripts,
      gitignoreEntriesAdded,
      port: effectivePort,
      derivedPort,
      portSource,
    }
  } finally {
    if (promptRuntime) {
      await promptRuntime.close()
    }
  }
}
