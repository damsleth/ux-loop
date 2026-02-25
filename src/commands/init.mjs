import fs from "fs"
import path from "path"

function parseInitArgs(args) {
  const flags = new Set(args)
  const presetArg = args.find((arg) => arg.startsWith("--preset="))
  const preset = presetArg ? presetArg.slice("--preset=".length) : "playwright-vite"
  return {
    force: flags.has("--force"),
    preset,
  }
}

function writeFileGuarded(filePath, content, force) {
  if (fs.existsSync(filePath) && !force) {
    throw new Error(`File already exists: ${filePath}. Use --force to overwrite.`)
  }
  fs.writeFileSync(filePath, content, "utf8")
}

export async function runInit(args = [], cwd = process.cwd()) {
  const { force, preset } = parseInitArgs(args)
  if (preset !== "playwright-vite") {
    throw new Error(`Unsupported preset \"${preset}\". Supported: playwright-vite`)
  }

  const configPath = path.join(cwd, "uxl.config.mjs")

  const configContent = `import { defineUxlConfig } from "@damsleth/ux-loop"

export default defineUxlConfig({
  capture: {
    runner: "playwright",
    baseUrl: process.env.UI_REVIEW_BASE_URL || "http://127.0.0.1:5173",
    timeoutMs: 120000,
    playwright: {
      startCommand: "dev",
      devices: [
        { name: "mobile", width: 390, height: 844 },
        { name: "desktop", width: 1280, height: 800 },
      ],
      flows: [
        {
          label: "Home — Mobile vs Desktop",
          name: "home",
          path: "/",
          waitFor: "main",
          settleMs: 250,
          screenshot: { fullPage: true },
        },
      ],
    },
  },
  review: {
    runner: "codex",
  },
  implement: {
    target: "worktree",
  },
})
`

  writeFileGuarded(configPath, configContent, force)

  return {
    configPath,
  }
}
