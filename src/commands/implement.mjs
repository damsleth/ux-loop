import fs from "fs"
import path from "path"
import { loadConfig } from "../config/load-config.mjs"
import { cleanupWorktreeTarget, resolveTarget } from "../git/target-resolver.mjs"
import { buildDefaultImplementPrompt } from "../prompts/default-implement-prompt.mjs"
import { runCodexImplement } from "../runners/implement-codex.mjs"
import { runCopilotImplement } from "../runners/implement-copilot.mjs"
import { assertCommandAvailable, runCommand } from "../utils/process.mjs"
import { validateReasoningEffort } from "../utils/reasoning-effort.mjs"

export const IMPLEMENT_OPTION_NAMES = new Set(["target", "branch", "worktree", "model", "reasoning-effort"])

function parseOptionArgs(args, allowedOptions) {
  const values = {}
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`)
    }

    if (token.includes("=")) {
      const [rawKey, ...rest] = token.slice(2).split("=")
      if (!allowedOptions.has(rawKey)) {
        throw new Error(`Unknown flag: --${rawKey}`)
      }
      const value = rest.join("=")
      if (!value) {
        throw new Error(`Missing value for --${rawKey}`)
      }
      values[rawKey] = value
      continue
    }

    const key = token.slice(2)
    if (!allowedOptions.has(key)) {
      throw new Error(`Unknown flag: --${key}`)
    }

    const next = args[i + 1]
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`)
    }

    values[key] = next
    i += 1
  }

  return values
}

export function parseImplementArgs(args) {
  const parsed = parseOptionArgs(args, IMPLEMENT_OPTION_NAMES)
  const values = {}
  if (parsed.target !== undefined) values.target = parsed.target
  if (parsed.branch !== undefined) values.branch = parsed.branch
  if (parsed.worktree !== undefined) values.worktree = parsed.worktree
  if (parsed.model !== undefined) values.model = parsed.model
  if (parsed["reasoning-effort"] !== undefined) values.reasoningEffort = parsed["reasoning-effort"]
  return values
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
    .filter((entry) => /^uxl_report_\d{4}-\d{2}-\d{2}_\d{4,9}\.md$/.test(entry))

  if (matches.length === 0) return undefined
  return matches
    .map((entry) => path.join(reportDir, entry))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0]
}

function commitImplementedChanges(workDir, runSyncCommand) {
  const status = runSyncCommand("git", ["status", "--porcelain"], { cwd: workDir })
  if (!status.stdout.trim()) {
    return false
  }

  runSyncCommand("git", ["add", "-A"], { cwd: workDir, stdio: "inherit" })
  const staged = runSyncCommand("git", ["diff", "--cached", "--name-only"], { cwd: workDir })
  if (!staged.stdout.trim()) {
    return false
  }

  runSyncCommand("git", ["commit", "-m", "chore: apply ux loop improvements"], {
    cwd: workDir,
    stdio: "inherit",
  })
  return true
}

export async function runImplement(args = [], cwd = process.cwd(), runtime = {}) {
  const overrides = parseImplementArgs(args)
  const load = runtime.loadConfig || loadConfig
  const resolveTargetStep = runtime.resolveTarget || resolveTarget
  const cleanupTarget = runtime.cleanupWorktreeTarget || cleanupWorktreeTarget
  const ensureCommand = runtime.assertCommandAvailable || assertCommandAvailable
  const runCodex = runtime.runCodexImplement || runCodexImplement
  const runCopilot = runtime.runCopilotImplement || runCopilotImplement
  const runSyncCommand = runtime.runCommand || runCommand
  if (overrides.target !== undefined && !["current", "branch", "worktree"].includes(overrides.target)) {
    throw new Error(`Invalid --target: "${overrides.target}". Allowed: current, branch, worktree.`)
  }

  const config = await load(cwd)
  const runner = (config.implement.runner || "codex").toLowerCase()
  validateReasoningEffort(overrides.reasoningEffort, "--reasoning-effort")
  if (!["codex", "copilot"].includes(runner)) {
    throw new Error(`Invalid implement.runner: "${runner}". Allowed: codex, copilot.`)
  }

  const bin = runner === "copilot" ? config.implement.copilot.bin : config.implement.codex.bin
  ensureCommand(bin)

  const reportMarkdown = readReport(config.paths.reportPath)
  const prepared = resolveTargetStep({
    repoRoot: config.paths.root,
    implementConfig: config.implement,
    overrides,
  })

  const prompt = buildDefaultImplementPrompt(reportMarkdown, {
    autoCommit: config.implement.autoCommit,
  })
  const model = overrides.model || config.implement.model
  const reasoningEffort = overrides.reasoningEffort || config.implement.reasoningEffort
  const targetMode = overrides.target || config.implement.target

  console.log(prepared.summary)
  try {
    if (runner === "copilot") {
      runCopilot({
        copilotBin: config.implement.copilot.bin,
        model,
        timeoutMs: config.implement.timeoutMs,
        workDir: prepared.workDir,
        prompt,
      })
    } else {
      runCodex({
        codexBin: config.implement.codex.bin,
        model,
        reasoningEffort,
        timeoutMs: config.implement.timeoutMs,
        workDir: prepared.workDir,
        prompt,
      })
    }
  } catch (error) {
    if (targetMode === "worktree") {
      try {
        cleanupTarget({
          repoRoot: config.paths.root,
          workDir: prepared.workDir,
          branchName: prepared.branchName,
        })
      } catch (cleanupError) {
        const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        console.warn(`Warning: ${message}`)
      }
    }
    throw error
  }

  let committed = false
  if (config.implement.autoCommit) {
    committed = commitImplementedChanges(prepared.workDir, runSyncCommand)
  }

  console.log("UX implementation run completed.")
  if (config.implement.autoCommit) {
    console.log(committed ? "Changes committed automatically." : "Auto-commit enabled, but there were no changes to commit.")
  }
  if (targetMode === "worktree") {
    console.log(`Worktree path: ${prepared.workDir}`)
    console.log(`Branch: ${prepared.branchName}`)
  }
}
