import fs from "fs"
import path from "path"
import { loadConfig } from "../config/load-config.mjs"
import { buildDefaultReviewPrompt } from "../prompts/default-review-prompt.mjs"
import { loadStylePreset } from "../prompts/load-style-preset.mjs"
import { assertCodexReady, reviewWithCodex } from "../runners/review-codex.mjs"
import { assertCopilotReady, reviewWithCopilot } from "../runners/review-copilot.mjs"
import { reviewWithOpenAi } from "../runners/review-openai.mjs"
import { writeJsonArtifact } from "../utils/artifacts.mjs"
import { createCommandLogger } from "../utils/command-logger.mjs"
import { parseCliOptions } from "../utils/parse-cli-options.mjs"
import { validateReasoningEffort } from "../utils/reasoning-effort.mjs"
import { buildReviewScoreSummary, computeReviewScore } from "../utils/review-score.mjs"

export const REVIEW_VALUE_OPTIONS = new Set(["runner", "model", "reasoning-effort", "image-detail", "prompt-file", "style"])
const REVIEW_BOOLEAN_OPTIONS = new Set(["no-limits"])

export const REVIEW_OPTION_NAMES = new Set([...REVIEW_VALUE_OPTIONS, ...REVIEW_BOOLEAN_OPTIONS])

export function parseReviewArgs(args) {
  const parsed = parseCliOptions(args, {
    valueOptions: REVIEW_VALUE_OPTIONS,
    booleanOptions: REVIEW_BOOLEAN_OPTIONS,
  })
  const values = {}
  if (parsed.runner !== undefined) values.runner = parsed.runner
  if (parsed.model !== undefined) values.model = parsed.model
  if (parsed["reasoning-effort"] !== undefined) values.reasoningEffort = parsed["reasoning-effort"]
  if (parsed["image-detail"] !== undefined) values.imageDetail = parsed["image-detail"]
  if (parsed["prompt-file"] !== undefined) values.promptFile = parsed["prompt-file"]
  if (parsed.style !== undefined) values.style = parsed.style
  if (parsed["no-limits"] !== undefined) values.noLimits = parsed["no-limits"]
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
  return buildReviewScoreSummary(text).totalIssues
}

function pad2(value) {
  return String(value).padStart(2, "0")
}

function pad3(value) {
  return String(value).padStart(3, "0")
}

export function buildTimestampedReportName(date = new Date()) {
  const yyyy = date.getFullYear()
  const mm = pad2(date.getMonth() + 1)
  const dd = pad2(date.getDate())
  const hh = pad2(date.getHours())
  const min = pad2(date.getMinutes())
  const sec = pad2(date.getSeconds())
  const ms = pad3(date.getMilliseconds())
  return `uxl_report_${yyyy}-${mm}-${dd}_${hh}${min}${sec}${ms}.md`
}

export function resolveReportOutputPath(configuredReportPath, date = new Date()) {
  if (path.basename(configuredReportPath) !== "report.md") {
    return configuredReportPath
  }
  return path.join(path.dirname(configuredReportPath), buildTimestampedReportName(date))
}

function sumIssueCounts(left, right) {
  return {
    critical: (left?.critical || 0) + (right?.critical || 0),
    major: (left?.major || 0) + (right?.major || 0),
    minor: (left?.minor || 0) + (right?.minor || 0),
  }
}

export async function runReview(args = [], cwd = process.cwd(), runtime = {}) {
  const startedAt = Date.now()
  const overrides = parseReviewArgs(args)
  const load = runtime.loadConfig || loadConfig
  const runCodexReview = runtime.reviewWithCodex || reviewWithCodex
  const runCopilotReview = runtime.reviewWithCopilot || reviewWithCopilot
  const runOpenAiReview = runtime.reviewWithOpenAi || reviewWithOpenAi
  const loggerFactory = runtime.createCommandLogger || createCommandLogger
  const loadPreset = runtime.loadStylePreset || loadStylePreset
  const writeArtifact = runtime.writeJsonArtifact || writeJsonArtifact
  const readFile = runtime.readFileSync || fs.readFileSync
  const config = await load(cwd)
  const manifest = readManifest(config.paths.manifestPath)
  const logger = loggerFactory({
    scope: "review",
    logsDir: config.paths.logsDir,
    echoToConsole: config.output.verbose,
  })
  validateReasoningEffort(overrides.reasoningEffort, "--reasoning-effort")
  validateImageDetail(overrides.imageDetail, "--image-detail")

  const runner = (overrides.runner || config.review.runner || "codex").toLowerCase()
  const model = overrides.model || config.review.model
  const reasoningEffort = overrides.reasoningEffort || config.review.reasoningEffort
  const imageDetail = overrides.imageDetail || config.review.openai.imageDetail || "high"
  const reportOutputPath = resolveReportOutputPath(config.paths.reportPath)
  const maxReviewGroups = config.limits?.maxReviewGroups || manifest.groups.length
  const maxGroups = overrides.noLimits ? manifest.groups.length : Math.min(manifest.groups.length, maxReviewGroups)
  const style = overrides.style || config.style
  let prompt

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

  if (overrides.promptFile) {
    const promptPath = path.resolve(config.paths.root, overrides.promptFile)
    if (!fs.existsSync(promptPath)) {
      throw new Error(`Prompt file not found: ${promptPath}`)
    }
    prompt = readFile(promptPath, "utf8").trim()
  } else if (config.review.systemPrompt) {
    prompt = config.review.systemPrompt
  } else {
    prompt = buildDefaultReviewPrompt({
      style: await loadPreset(style, config.paths.root),
      maxPromptTokens: overrides.noLimits ? undefined : config.limits?.maxPromptTokens,
      warn: (message) => logger.warn(message),
    })
  }

  const groups = manifest.groups.slice(0, maxGroups)

  logger.log(`Starting review in ${config.paths.root}`)
  logger.log(`Manifest: ${config.paths.manifestPath}`)
  logger.log(`Report output: ${reportOutputPath}`)
  logger.log(`Runner: ${runner}`)
  logger.log(`Model: ${model || "default"}`)
  logger.log(`Reasoning effort: ${reasoningEffort || "default"}`)
  logger.log(`Image detail: ${imageDetail}`)
  logger.log(`Screenshot groups: ${groups.length}/${manifest.groups.length}`)
  logger.log(`System prompt:\n${prompt}`)

  if (!overrides.noLimits && manifest.groups.length > groups.length) {
    const message = `Limit reached: ${groups.length}/${maxReviewGroups} review groups processed, skipping remaining.`
    logger.warn(message)
    console.warn(message)
  }

  console.log(`Reviewing ${groups.length} screenshot group${groups.length === 1 ? "" : "s"}...`)

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
  if (style) {
    report.push(`Style: ${style}`)
  }
  report.push("")

  let aggregateIssues = { critical: 0, major: 0, minor: 0 }
  const stepDetails = []

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]
    const filePaths = group.files.map((entry) => toAbsolute(config.paths.root, entry))
    logger.log(`Processing group ${index + 1}/${groups.length}: ${group.label}`)
    logger.log(`Images (${filePaths.length}): ${filePaths.join(", ")}`)
    const groupStartedAt = Date.now()
    const progress = startProgressAnimation(`Reviewing group ${index + 1}/${groups.length}: ${group.label}`)

    let critique
    try {
      critique =
        runner === "codex"
          ? await runCodexReview({
              codexBin: config.review.codex.bin,
              model,
              reasoningEffort,
              timeoutMs: config.review.timeoutMs,
              prompt,
              label: group.label,
              filePaths,
              logger,
            })
          : runner === "copilot"
            ? await runCopilotReview({
                copilotBin: config.review.copilot.bin,
                model,
                timeoutMs: config.review.timeoutMs,
                prompt,
                label: group.label,
                filePaths,
                rootDir: config.paths.root,
                logger,
              })
            : await runOpenAiReview({
                apiKey: process.env[config.review.openai.apiKeyEnv],
                apiKeyEnv: config.review.openai.apiKeyEnv,
                imageDetail,
                model,
                prompt,
                label: group.label,
                filePaths,
                timeoutMs: config.review.timeoutMs,
                logger,
              })
      progress.stop(`Reviewed group ${index + 1}/${groups.length}: ${group.label} (${Date.now() - groupStartedAt}ms)`)
    } catch (error) {
      progress.stop(`Review failed for group ${index + 1}/${groups.length}: ${group.label}`)
      throw error
    }

    const scoreSummary = buildReviewScoreSummary(critique)
    aggregateIssues = sumIssueCounts(aggregateIssues, scoreSummary.issues)
    stepDetails.push({
      label: group.label,
      duration_ms: Date.now() - groupStartedAt,
      issues: scoreSummary.issues,
      score: scoreSummary.score,
      totalIssues: scoreSummary.totalIssues,
    })

    report.push(`## ${group.label}`)
    report.push("")
    report.push(critique)
    report.push("")
    logger.log(`Completed group ${index + 1}/${groups.length}: ${group.label}`)
  }

  const totalIssues = aggregateIssues.critical + aggregateIssues.major + aggregateIssues.minor
  const score = totalIssues === 0 ? 100 : computeReviewScore(aggregateIssues)

  report.splice(
    7,
    0,
    `Review score: ${score}/100 (${aggregateIssues.critical} critical, ${aggregateIssues.major} major, ${aggregateIssues.minor} minor)`,
    ""
  )

  fs.mkdirSync(path.dirname(reportOutputPath), { recursive: true })
  fs.writeFileSync(reportOutputPath, `${report.join("\n")}\n`, "utf8")
  const reportJsonPath = writeArtifact({
    dir: config.paths.reportsDir || path.join(config.paths.root, ".uxl", "reports"),
    prefix: "uxl_report",
    payload: {
      timestamp: new Date().toISOString(),
      command: "review",
      status: "success",
      duration_ms: Date.now() - startedAt,
      model: model || null,
      scope: null,
      iteration: 1,
      steps: [
        {
          step: "review",
          duration_ms: Date.now() - startedAt,
          groups_processed: groups.length,
          issues: aggregateIssues,
          score,
          group_details: stepDetails,
        },
      ],
    },
  })
  logger.log(`Finished review for ${groups.length} groups`)
  logger.log(
    `Summary: Review score ${score}/100 (${aggregateIssues.critical} critical, ${aggregateIssues.major} major, ${aggregateIssues.minor} minor)`
  )
  logger.log(`Report written: ${reportOutputPath}`)
  logger.log(`Structured report written: ${reportJsonPath}`)
  console.log(
    `Review complete. Review score: ${score}/100 (${aggregateIssues.critical} critical, ${aggregateIssues.major} major, ${aggregateIssues.minor} minor).`
  )
  console.log(`Report: ${reportOutputPath}`)

  return {
    status: "success",
    reportPath: reportOutputPath,
    reportJsonPath,
    score,
    issues: aggregateIssues,
    totalIssues,
    runner,
    model: model || null,
    groupsProcessed: groups.length,
  }
}
