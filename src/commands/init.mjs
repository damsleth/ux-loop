import fs from "fs"
import path from "path"
import readline from "node:readline/promises"
import {
  buildFlowScaffold,
  detectPlaywrightInstalled,
  evaluateFlowCoverage,
} from "../capture/flow-onboarding.mjs"

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

function serializeConfig(config) {
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
    'process.env.UI_REVIEW_BASE_URL || "http://127.0.0.1:5173"'
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
  let promptRuntime = runtime.prompt ? { ask: runtime.prompt, close: async () => {} } : null
  const ask = async (message) => {
    if (!promptRuntime) {
      promptRuntime = createDefaultPrompt()
    }
    return promptRuntime.ask(message)
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
          startCommand: "dev",
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

    writeFileGuarded(configPath, serializeConfig(configObject), force)

    return {
      configPath,
      onboardingStatus,
      playwrightInstalled,
      warnings,
    }
  } finally {
    if (promptRuntime) {
      await promptRuntime.close()
    }
  }
}
