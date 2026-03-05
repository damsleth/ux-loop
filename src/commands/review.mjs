import fs from "fs"
import path from "path"
import { loadConfig } from "../config/load-config.mjs"
import { DEFAULT_REVIEW_PROMPT } from "../prompts/default-review-prompt.mjs"
import { assertCodexReady, reviewWithCodex } from "../runners/review-codex.mjs"
import { assertCopilotReady, reviewWithCopilot } from "../runners/review-copilot.mjs"
import { reviewWithOpenAi } from "../runners/review-openai.mjs"
import { createCommandLogger } from "../utils/command-logger.mjs"
import { validateReasoningEffort } from "../utils/reasoning-effort.mjs"

export function parseReviewArgs(args) {
  const values = {}
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (token.startsWith("--runner=")) values.runner = token.slice("--runner=".length)
    else if (token === "--runner") values.runner = args[i + 1]
    if (token.startsWith("--model=")) values.model = token.slice("--model=".length)
    else if (token === "--model") values.model = args[i + 1]
    if (token.startsWith("--reasoning-effort=")) values.reasoningEffort = token.slice("--reasoning-effort=".length)
    else if (token === "--reasoning-effort") values.reasoningEffort = args[i + 1]
    if (token.startsWith("--image-detail=")) values.imageDetail = token.slice("--image-detail=".length)
    else if (token === "--image-detail") values.imageDetail = args[i + 1]
  }
  return values
}

function validateImageDetail(value, sourceLabel) {
  if (value === undefined) return
  const allowed = ["low", "auto", "high"]
  if (!allowed.includes(value)) {
    throw new Error(`Invalid ${sourceLabel}: "${value}". Allowed: ${allowed.join(", ")}.`)
  }
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

const SPINNER_FRAMES = ["|", "/", "-", "\\"]

function startProgressAnimation(label) {
  if (!process.stdout?.isTTY) {
    return {
      stop() {},
    }
  }

  let frame = 0
  const render = () => {
    const symbol = SPINNER_FRAMES[frame % SPINNER_FRAMES.length]
    process.stdout.write(`\r${label} ${symbol}`)
    frame += 1
  }

  render()
  const timer = setInterval(render, 100)

  return {
    stop(message) {
      clearInterval(timer)
      process.stdout.write("\r\x1b[2K")
      process.stdout.write(`${message}\n`)
    },
  }
}

export function countIssuesInCritique(text) {
  const normalized = String(text || "").trim()
  if (!normalized) return 0
  if (/no issues found\.?/i.test(normalized)) return 0

  const bulletLines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .filter((line) => !/no issues found\.?/i.test(line))

  if (bulletLines.length > 0) return bulletLines.length
  return 0
}

function pad2(value) {
  return String(value).padStart(2, "0")
}

function buildTimestampedReportName(date = new Date()) {
  const yyyy = date.getFullYear()
  const mm = pad2(date.getMonth() + 1)
  const dd = pad2(date.getDate())
  const hh = pad2(date.getHours())
  const min = pad2(date.getMinutes())
  return `uxl_report_${yyyy}-${mm}-${dd}_${hh}${min}.md`
}

function resolveReportOutputPath(configuredReportPath, date = new Date()) {
  if (path.basename(configuredReportPath) !== "report.md") {
    return configuredReportPath
  }
  return path.join(path.dirname(configuredReportPath), buildTimestampedReportName(date))
}

export async function runReview(args = [], cwd = process.cwd()) {
  const overrides = parseReviewArgs(args)
  const config = await loadConfig(cwd)
  const manifest = readManifest(config.paths.manifestPath)
  const logger = createCommandLogger({ scope: "review", logsDir: config.paths.logsDir })
  validateReasoningEffort(overrides.reasoningEffort, "--reasoning-effort")
  validateImageDetail(overrides.imageDetail, "--image-detail")

  const runner = (overrides.runner || config.review.runner || "codex").toLowerCase()
  const model = overrides.model || config.review.model
  const reasoningEffort = overrides.reasoningEffort || config.review.reasoningEffort
  const imageDetail = overrides.imageDetail || config.review.openai.imageDetail || "high"
  const prompt = config.review.systemPrompt || DEFAULT_REVIEW_PROMPT
  const reportOutputPath = resolveReportOutputPath(config.paths.reportPath)

  if (!["codex", "copilot", "openai"].includes(runner)) {
    throw new Error(`Invalid review runner: "${runner}". Allowed: codex, copilot, openai.`)
  }

  if (runner === "openai" && !model) {
    throw new Error("review.model is required when using the OpenAI runner. Set it in config or pass --model.")
  }

  if (runner === "codex") {
    assertCodexReady(config.review.codex.bin)
  }
  if (runner === "copilot") {
    assertCopilotReady(config.review.copilot.bin)
  }

  logger.log(`Starting review in ${config.paths.root}`)
  logger.log(`Manifest: ${config.paths.manifestPath}`)
  logger.log(`Report output: ${reportOutputPath}`)
  logger.log(`Runner: ${runner}`)
  logger.log(`Model: ${model || "default"}`)
  logger.log(`Reasoning effort: ${reasoningEffort || "default"}`)
  logger.log(`Image detail: ${imageDetail}`)
  logger.log(`Screenshot groups: ${manifest.groups.length}`)
  logger.log(`System prompt:\n${prompt}`)

  const report = []
  report.push("# UX Review Report")
  report.push("")
  report.push(`Generated: ${new Date().toISOString()}`)
  const runnerDescription = runner === "codex"
    ? `Runner: codex CLI (${config.review.codex.bin})`
    : runner === "copilot"
      ? `Runner: copilot CLI (${config.review.copilot.bin})`
      : "Runner: OpenAI API"
  report.push(runnerDescription)
  report.push(`Model: ${model || "default"}`)
  report.push(`Reasoning effort: ${reasoningEffort || "default"}`)
  report.push(`Image detail: ${imageDetail}`)
  report.push("")
  let totalIssues = 0

  for (let index = 0; index < manifest.groups.length; index += 1) {
    const group = manifest.groups[index]
    const filePaths = group.files.map((entry) => toAbsolute(config.paths.root, entry))
    logger.log(`Processing group ${index + 1}/${manifest.groups.length}: ${group.label}`)
    logger.log(`Images (${filePaths.length}): ${filePaths.join(", ")}`)
    const startedAt = Date.now()
    const progress = startProgressAnimation(`Reviewing group ${index + 1}/${manifest.groups.length}: ${group.label}`)

    let critique
    try {
      critique =
        runner === "codex"
          ? await reviewWithCodex({
              codexBin: config.review.codex.bin,
              model,
              reasoningEffort,
              prompt,
              label: group.label,
              filePaths,
              logger,
            })
          : runner === "copilot"
            ? await reviewWithCopilot({
                copilotBin: config.review.copilot.bin,
                model,
                prompt,
                label: group.label,
                filePaths,
                rootDir: config.paths.root,
                logger,
              })
          : await reviewWithOpenAi({
              apiKey: process.env[config.review.openai.apiKeyEnv],
              imageDetail,
              model,
              prompt,
              label: group.label,
              filePaths,
              logger,
            })
      progress.stop(`Reviewed group ${index + 1}/${manifest.groups.length}: ${group.label} (${Date.now() - startedAt}ms)`)
    } catch (error) {
      progress.stop(`Review failed for group ${index + 1}/${manifest.groups.length}: ${group.label}`)
      throw error
    }

    report.push(`## ${group.label}`)
    report.push("")
    report.push(critique)
    report.push("")
    totalIssues += countIssuesInCritique(critique)
    logger.log(`Completed group ${index + 1}/${manifest.groups.length}: ${group.label}`)
  }

  fs.mkdirSync(path.dirname(reportOutputPath), { recursive: true })
  fs.writeFileSync(reportOutputPath, `${report.join("\n")}\n`, "utf8")
  logger.log(`Finished review for ${manifest.groups.length} groups`)
  logger.log(`Summary: ${totalIssues} issue${totalIssues === 1 ? "" : "s"} found`)
  logger.log(`Report written: ${reportOutputPath}`)
}
