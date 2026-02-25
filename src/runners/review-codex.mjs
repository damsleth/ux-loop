import fs from "fs"
import os from "os"
import path from "path"
import { runCommand } from "../utils/process.mjs"

export function assertCodexReady(codexBin) {
  runCommand(codexBin, ["--version"])
}

export function reviewWithCodex({ codexBin, model, prompt, label, filePaths }) {
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
  args.push("--image", filePaths.join(","), "-")

  const fullPrompt = `${prompt}\n\nReview these screenshots as one group: ${label}.`

  try {
    const result = runCommand(codexBin, args, {
      input: fullPrompt,
      maxBuffer: 10 * 1024 * 1024,
    })

    if (result.error) {
      throw result.error
    }

    if (!fs.existsSync(lastMessagePath)) {
      throw new Error(`Codex did not produce output for \"${label}\".`)
    }

    const text = fs.readFileSync(lastMessagePath, "utf8").trim()
    if (!text) {
      throw new Error(`Codex response for \"${label}\" did not contain text output.`)
    }
    return text
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true })
  }
}
