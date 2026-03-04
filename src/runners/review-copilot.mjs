import fs from "fs"
import { runCommand, runCommandAsync } from "../utils/process.mjs"

function quoteArg(value) {
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(value)) return value
  return JSON.stringify(value)
}

function formatCommand(command, args) {
  return [command, ...args.map((arg) => quoteArg(arg))].join(" ")
}

export function assertCopilotReady(copilotBin) {
  runCommand(copilotBin, ["--version"])
}

export async function reviewWithCopilot({ copilotBin, model, prompt, label, filePaths, rootDir, logger = console }) {
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing screenshot: ${filePath}`)
    }
  }

  const screenshotList = filePaths.map((filePath) => `- ${filePath}`).join("\n")
  const fullPrompt = `${prompt}

Review these screenshots as one group: ${label}.
Use the screenshot files at these absolute paths:
${screenshotList}`

  const args = [
    "--allow-all-tools",
    "--no-color",
    "--stream",
    "off",
    "--log-level",
    "error",
    "--add-dir",
    rootDir,
    "--prompt",
    fullPrompt,
  ]
  if (model) {
    args.push("--model", model)
  }

  logger?.log?.(`Copilot command: ${formatCommand(copilotBin, args)}`)
  const startedAt = Date.now()
  const result = await runCommandAsync(copilotBin, args, {
    maxBuffer: 10 * 1024 * 1024,
    cwd: rootDir,
  })
  logger?.log?.(`Copilot completed for "${label}" in ${Date.now() - startedAt}ms`)

  if (result.stderr?.trim()) {
    const lineCount = result.stderr.trim().split(/\r?\n/).length
    logger?.warn?.(`Copilot stderr for "${label}" (${lineCount} lines)`)
  }

  const text = (result.stdout || "").trim()
  if (!text) {
    throw new Error(`Copilot response for "${label}" did not contain text output.`)
  }

  logger?.log?.(`Copilot output for "${label}":\n${text}`)
  return text
}
