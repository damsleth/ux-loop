import fs from "fs"
import path from "path"
import { loadConfig } from "../config/load-config.mjs"
import { resolveTarget } from "../git/target-resolver.mjs"
import { buildDefaultImplementPrompt } from "../prompts/default-implement-prompt.mjs"
import { runCodexImplement } from "../runners/implement-codex.mjs"
import { runCopilotImplement } from "../runners/implement-copilot.mjs"
import { assertCommandAvailable } from "../utils/process.mjs"

const REASONING_EFFORT_VALUES = ["low", "medium", "high", "extraHigh"]

export function parseImplementArgs(args) {
  const values = {}
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (token.startsWith("--target=")) values.target = token.slice("--target=".length)
    else if (token === "--target") values.target = args[i + 1]
    if (token.startsWith("--branch=")) values.branch = token.slice("--branch=".length)
    else if (token === "--branch") values.branch = args[i + 1]
    if (token.startsWith("--worktree=")) values.worktree = token.slice("--worktree=".length)
    else if (token === "--worktree") values.worktree = args[i + 1]
    if (token.startsWith("--model=")) values.model = token.slice("--model=".length)
    else if (token === "--model") values.model = args[i + 1]
    if (token.startsWith("--reasoning-effort=")) values.reasoningEffort = token.slice("--reasoning-effort=".length)
    else if (token === "--reasoning-effort") values.reasoningEffort = args[i + 1]
  }
  return values
}

function validateReasoningEffort(value, sourceLabel) {
  if (value === undefined) return
  if (!REASONING_EFFORT_VALUES.includes(value)) {
    throw new Error(`Invalid ${sourceLabel}: "${value}". Allowed: ${REASONING_EFFORT_VALUES.join(", ")}.`)
  }
}

function readReport(reportPath) {
  const resolvedReportPath = resolveReportInputPath(reportPath)

  if (!fs.existsSync(resolvedReportPath)) {
    throw new Error(`Report not found: ${resolvedReportPath}. Run \`uxl review\` first.`)
  }
  const text = fs.readFileSync(resolvedReportPath, "utf8").trim()
  if (!text) {
    throw new Error(`Report is empty: ${resolvedReportPath}. Run \`uxl review\` first.`)
  }
  return text
}

export function resolveReportInputPath(reportPath) {
  if (!fs.existsSync(reportPath)) {
    if (path.basename(reportPath) !== "report.md") {
      throw new Error(`Report not found: ${reportPath}. Run \`uxl review\` first.`)
    }

    const latestReportPath = findLatestTimestampedReport(path.dirname(reportPath))
    if (!latestReportPath) {
      throw new Error(`Report not found: ${reportPath}. Run \`uxl review\` first.`)
    }
    return latestReportPath
  }

  return reportPath
}

function findLatestTimestampedReport(reportDir) {
  if (!fs.existsSync(reportDir)) return undefined

  const matches = fs
    .readdirSync(reportDir)
    .filter((entry) => /^uxl_report_\d{4}-\d{2}-\d{2}_\d{4}\.md$/.test(entry))
    .sort()

  if (matches.length === 0) return undefined
  return path.join(reportDir, matches[matches.length - 1])
}

export async function runImplement(args = [], cwd = process.cwd()) {
  const overrides = parseImplementArgs(args)
  const config = await loadConfig(cwd)
  const runner = (config.implement.runner || "codex").toLowerCase()
  validateReasoningEffort(overrides.reasoningEffort, "--reasoning-effort")
  if (!["codex", "copilot"].includes(runner)) {
    throw new Error(`Invalid implement.runner: "${runner}". Allowed: codex, copilot.`)
  }

  const bin = runner === "copilot" ? config.implement.copilot.bin : config.implement.codex.bin
  assertCommandAvailable(bin)

  const reportMarkdown = readReport(config.paths.reportPath)
  const prepared = resolveTarget({
    repoRoot: config.paths.root,
    implementConfig: config.implement,
    overrides,
  })

  const prompt = buildDefaultImplementPrompt(reportMarkdown)
  const model = overrides.model || config.implement.model
  const reasoningEffort = overrides.reasoningEffort || config.implement.reasoningEffort

  console.log(prepared.summary)
  if (runner === "copilot") {
    runCopilotImplement({
      copilotBin: config.implement.copilot.bin,
      model,
      workDir: prepared.workDir,
      prompt,
    })
  } else {
    runCodexImplement({
      codexBin: config.implement.codex.bin,
      model,
      reasoningEffort,
      workDir: prepared.workDir,
      prompt,
    })
  }

  console.log("UX implementation run completed.")
  if ((overrides.target || config.implement.target) === "worktree") {
    console.log(`Worktree path: ${prepared.workDir}`)
    console.log(`Branch: ${prepared.branchName}`)
  }
}
