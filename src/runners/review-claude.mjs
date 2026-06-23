import fs from "fs"
import { runCommand, runCommandAsync } from "../utils/process.mjs"

function quoteArg(value) {
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(value)) return value
  return JSON.stringify(value)
}

function formatCommand(command, args) {
  return [command, ...args.map((arg) => quoteArg(arg))].join(" ")
}

export function assertClaudeReady(claudeBin) {
  runCommand(claudeBin, ["--version"])
}

export async function reviewWithClaude({
  claudeBin,
  model,
  reasoningEffort,
  timeoutMs,
  prompt,
  label,
  filePaths,
  rootDir,
  logger = console,
}) {
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing screenshot: ${filePath}`)
    }
  }

  // reasoningEffort is a codex-ism; the claude CLI has no equivalent flag.
  if (reasoningEffort) {
    logger?.warn?.(`Claude runner ignores reasoning effort "${reasoningEffort}" (no CLI equivalent).`)
  }

  const screenshotList = filePaths.map((filePath) => `- ${filePath}`).join("\n")
  const fullPrompt = `${prompt}

Review these screenshots as one group: ${label}.
Read the screenshot files at these absolute paths:
${screenshotList}`

  // -p print mode; prompt via stdin (argv has size limits, stdin does not).
  // The CLI has no --image flag — the agent reads screenshots via its Read tool,
  // so restrict to Read for parity with codex's --sandbox read-only.
  // --strict-mcp-config (no --mcp-config) disables the user's MCP servers.
  const args = [
    "-p",
    "--output-format",
    "text",
    "--strict-mcp-config",
    "--allowedTools",
    "Read",
  ]
  if (model) {
    args.push("--model", model)
  }

  logger?.log?.(`Claude command: ${formatCommand(claudeBin, args)}`)
  const startedAt = Date.now()
  const result = await runCommandAsync(claudeBin, args, {
    input: fullPrompt,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
    cwd: rootDir,
    timeoutMs,
  })
  logger?.log?.(`Claude completed for "${label}" in ${Date.now() - startedAt}ms`)

  if (result.stderr?.trim()) {
    const lineCount = result.stderr.trim().split(/\r?\n/).length
    logger?.warn?.(`Claude stderr for "${label}" (${lineCount} lines)`)
  }

  const text = (result.stdout || "").trim()
  if (!text) {
    throw new Error(`Claude response for "${label}" did not contain text output.`)
  }

  logger?.log?.(`Claude output for "${label}":\n${text}`)
  return text
}
