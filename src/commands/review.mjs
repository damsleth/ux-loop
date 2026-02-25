import fs from "fs"
import path from "path"
import { loadConfig } from "../config/load-config.mjs"
import { DEFAULT_REVIEW_PROMPT } from "../prompts/default-review-prompt.mjs"
import { assertCodexReady, reviewWithCodex } from "../runners/review-codex.mjs"
import { reviewWithOpenAi } from "../runners/review-openai.mjs"

export function parseReviewArgs(args) {
  const values = {}
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (token.startsWith("--runner=")) values.runner = token.slice("--runner=".length)
    else if (token === "--runner") values.runner = args[i + 1]
    if (token.startsWith("--model=")) values.model = token.slice("--model=".length)
    else if (token === "--model") values.model = args[i + 1]
  }
  return values
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing manifest: ${manifestPath}. Run \`uxl shots\` first.`)
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  if (!Array.isArray(manifest.groups) || manifest.groups.length === 0) {
    throw new Error(`Manifest has no groups: ${manifestPath}`)
  }
  return manifest
}

function toAbsolute(rootDir, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath)
}

export async function runReview(args = [], cwd = process.cwd()) {
  const overrides = parseReviewArgs(args)
  const config = await loadConfig(cwd)
  const manifest = readManifest(config.paths.manifestPath)

  const runner = (overrides.runner || config.review.runner || "codex").toLowerCase()
  const model = overrides.model || config.review.model
  const prompt = config.review.systemPrompt || DEFAULT_REVIEW_PROMPT

  if (runner === "openai" && !model) {
    throw new Error("review.model is required when using the OpenAI runner. Set it in config or pass --model.")
  }

  if (runner === "codex") {
    assertCodexReady(config.review.codex.bin)
  }

  const report = []
  report.push("# UX Review Report")
  report.push("")
  report.push(`Generated: ${new Date().toISOString()}`)
  report.push(runner === "codex" ? `Runner: codex CLI (${config.review.codex.bin})` : "Runner: OpenAI API")
  report.push(`Model: ${model || "default"}`)
  report.push("")

  for (const group of manifest.groups) {
    const filePaths = group.files.map((entry) => toAbsolute(config.paths.root, entry))
    const critique =
      runner === "codex"
        ? await reviewWithCodex({
            codexBin: config.review.codex.bin,
            model,
            prompt,
            label: group.label,
            filePaths,
          })
        : await reviewWithOpenAi({
            apiKey: process.env[config.review.openai.apiKeyEnv],
            model,
            prompt,
            label: group.label,
            filePaths,
          })

    report.push(`## ${group.label}`)
    report.push("")
    report.push(critique)
    report.push("")
  }

  fs.mkdirSync(path.dirname(config.paths.reportPath), { recursive: true })
  fs.writeFileSync(config.paths.reportPath, `${report.join("\n")}\n`, "utf8")
  console.log(`Report written: ${config.paths.reportPath}`)
}
