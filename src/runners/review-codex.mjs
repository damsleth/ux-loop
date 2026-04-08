import fs from "fs"
import os from "os"
import path from "path"
import { runCommand, runCommandAsync } from "../utils/process.mjs"

export function assertCodexReady(codexBin) {
  runCommand(codexBin, ["--version"])
}

function quoteArg(value) {
  if (/^[A-Za-z0-9_./:=,-]+$/.test(value)) return value
  return JSON.stringify(value)
}

function formatCommand(command, args) {
  return [command, ...args.map((arg) => quoteArg(arg))].join(" ")
}

export async function reviewWithCodex({
  codexBin,
  model,
  reasoningEffort,
  timeoutMs,
  prompt,
  label,
  filePaths,
  logger = console,
}) {
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing screenshot: ${filePath}`)
    }
    if (filePath.includes(",")) {
      throw new Error(`Image path contains comma and cannot be passed as CSV list: ${filePath}`)
    }
  }

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-review-"))
  const lastMessagePath = path.join(outputDir, "last-message.txt")

  const args = [
    "exec",
    "--full-auto",
    "--ephemeral",
    "--color",
    "never",
    "--sandbox",
    "read-only",
    "--output-last-message",
    lastMessagePath,
  ]
  if (model) {
    args.push("--model", model)
  }
  if (reasoningEffort) {
    args.push("-c", `model_reasoning_effort=${reasoningEffort}`)
  }
  args.push("--image", filePaths.join(","), "-")

  const fullPrompt = `${prompt}\n\nReview these screenshots as one group: ${label}.`
  logger?.log?.(`Codex command: ${formatCommand(codexBin, args)}`)
  const startedAt = Date.now()

  try {
    const result = await runCommandAsync(codexBin, args, {
      input: fullPrompt,
      maxBuffer: 10 * 1024 * 1024,
      timeoutMs,
    })
    logger?.log?.(`Codex completed for "${label}" in ${Date.now() - startedAt}ms`)

    if (result.stderr?.trim()) {
      const lineCount = result.stderr.trim().split(/\r?\n/).length
      logger?.warn?.(`Codex stderr for "${label}" (${lineCount} lines)`)
    }

    if (!fs.existsSync(lastMessagePath)) {
      throw new Error(`Codex did not produce output for \"${label}\".`)
    }

    const text = fs.readFileSync(lastMessagePath, "utf8").trim()
    if (!text) {
      throw new Error(`Codex response for \"${label}\" did not contain text output.`)
    }
    logger?.log?.(`Codex output for "${label}":\n${text}`)
    return text
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true })
  }
}
