import fs from "fs"
import os from "os"
import path from "path"
import readline from "node:readline/promises"
import { loadConfig } from "../config/load-config.mjs"
import { cleanupWorktreeTarget, previewTarget, resolveTarget } from "../git/target-resolver.mjs"
import { writeSnapshot } from "../git/snapshots.mjs"
import { buildDefaultImplementPrompt } from "../prompts/default-implement-prompt.mjs"
import { loadStylePreset } from "../prompts/load-style-preset.mjs"
import { runCodexImplement } from "../runners/implement-codex.mjs"
import { runCopilotImplement } from "../runners/implement-copilot.mjs"
import { buildTimestampedArtifactName, writeJsonArtifact } from "../utils/artifacts.mjs"
import { parseNumstat } from "../utils/diff-stats.mjs"
import { parseCliOptions } from "../utils/parse-cli-options.mjs"
import { assertCommandAvailable, runCommand } from "../utils/process.mjs"
import { validateReasoningEffort } from "../utils/reasoning-effort.mjs"

const IMPLEMENT_VALUE_OPTIONS = new Set([
  "target",
  "branch",
  "worktree",
  "model",
  "reasoning-effort",
  "scope",
  "prompt-file",
  "style",
])
const IMPLEMENT_BOOLEAN_OPTIONS = new Set(["strict", "yes", "dry-run", "diff-only", "no-limits"])

export const IMPLEMENT_OPTION_NAMES = new Set([...IMPLEMENT_VALUE_OPTIONS, ...IMPLEMENT_BOOLEAN_OPTIONS])

export function parseImplementArgs(args) {
  const parsed = parseCliOptions(args, {
    valueOptions: IMPLEMENT_VALUE_OPTIONS,
    booleanOptions: IMPLEMENT_BOOLEAN_OPTIONS,
  })
  const values = {}
  if (parsed.target !== undefined) values.target = parsed.target
  if (parsed.branch !== undefined) values.branch = parsed.branch
  if (parsed.worktree !== undefined) values.worktree = parsed.worktree
  if (parsed.model !== undefined) values.model = parsed.model
  if (parsed["reasoning-effort"] !== undefined) values.reasoningEffort = parsed["reasoning-effort"]
  if (parsed.scope !== undefined) values.scope = parsed.scope
  if (parsed["prompt-file"] !== undefined) values.promptFile = parsed["prompt-file"]
  if (parsed.style !== undefined) values.style = parsed.style
  if (parsed.strict !== undefined) values.strict = parsed.strict
  if (parsed.yes !== undefined) values.yes = parsed.yes
  if (parsed["dry-run"] !== undefined) values.dryRun = parsed["dry-run"]
  if (parsed["diff-only"] !== undefined) values.diffOnly = parsed["diff-only"]
  if (parsed["no-limits"] !== undefined) values.noLimits = parsed["no-limits"]
  return values
}

function createPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return {
    ask: async (question) => rl.question(question),
    close: async () => rl.close(),
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

function getChangedFiles(workDir, runSyncCommand) {
  return runSyncCommand("git", ["diff", "--name-only", "HEAD", "--"], { cwd: workDir }).stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function collectDiffStats(workDir, runSyncCommand) {
  return parseNumstat(runSyncCommand("git", ["diff", "--numstat", "HEAD", "--"], { cwd: workDir }).stdout)
}

const CSS_ONLY_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less", ".vue", ".svelte"])
const LOGIC_EXTENSIONS = new Set([".js", ".ts", ".mjs", ".cjs", ".jsx", ".tsx"])
const TEXT_LIKE_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".html",
  ".htm",
  ".jsx",
  ".tsx",
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".json",
  ".yml",
  ".yaml",
  ".vue",
  ".svelte",
])

export function validateScopeAgainstFiles(files, scope) {
  const violations = []
  const warnings = []

  if (scope === "unrestricted") {
    return { violations, warnings }
  }

  for (const file of files) {
    const extension = path.extname(file).toLowerCase()
    if (scope === "css-only" && !CSS_ONLY_EXTENSIONS.has(extension)) {
      violations.push(`Scope violation (css-only): ${file}`)
    }

    if (scope === "layout-safe" && LOGIC_EXTENSIONS.has(extension)) {
      violations.push(`Scope violation (layout-safe): ${file}`)
    }

    if (scope === "text-only" && !TEXT_LIKE_EXTENSIONS.has(extension)) {
      warnings.push(`Potential text-only scope drift: ${file}`)
    }
  }

  return { violations, warnings }
}

function ensureInsideGitRepo(repoRoot, runSyncCommand) {
  runSyncCommand("git", ["rev-parse", "--is-inside-work-tree"], { cwd: repoRoot })
}

function isDirtyWorktree(repoRoot, runSyncCommand) {
  return Boolean(runSyncCommand("git", ["status", "--porcelain"], { cwd: repoRoot }).stdout.trim())
}

async function confirmCurrentTarget({ targetExplicit, targetMode, isDirty, yes, promptRuntime }) {
  if (targetMode !== "current") return
  if (yes) return
  if (isDirty) {
    throw new Error("Current target has uncommitted changes. Re-run with --yes to proceed.")
  }
  if (!targetExplicit) return
  if (!process.stdin.isTTY && !promptRuntime) {
    throw new Error("Using --target current requires confirmation. Re-run with --yes to proceed.")
  }

  const prompt = promptRuntime ? { ask: promptRuntime, close: async () => {} } : createPrompt()
  try {
    const answer = await prompt.ask("Apply changes directly to the current branch? Type yes: ")
    if (String(answer || "").trim().toLowerCase() !== "yes") {
      throw new Error("Implementation aborted.")
    }
  } finally {
    await prompt.close()
  }
}

async function resolvePrompt({ overrides, config, reportMarkdown, rootDir }) {
  if (overrides.promptFile) {
    const promptPath = path.resolve(rootDir, overrides.promptFile)
    if (!fs.existsSync(promptPath)) {
      throw new Error(`Prompt file not found: ${promptPath}`)
    }
    return fs.readFileSync(promptPath, "utf8").trim()
  }

  const style = await loadStylePreset(overrides.style || config.style, rootDir)
  return buildDefaultImplementPrompt(reportMarkdown, {
    autoCommit: config.implement.autoCommit,
    scope: overrides.scope || config.implement.scope,
    style,
    maxPromptTokens: overrides.noLimits ? undefined : config.limits?.maxPromptTokens,
  })
}

function stashDirtyCurrentTarget(repoRoot, runSyncCommand, label) {
  runSyncCommand("git", ["stash", "push", "--include-untracked", "-m", label], { cwd: repoRoot })
  const stashRef = runSyncCommand("git", ["stash", "list", "--format=%gd", "-1"], { cwd: repoRoot }).stdout.trim()
  return stashRef || null
}

function createSnapshotMetadata({ repoRoot, prepared, targetMode, dirtyBeforeRun, stashRef, runSyncCommand }) {
  return {
    createdAt: new Date().toISOString(),
    repoRoot,
    head: runSyncCommand("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).stdout.trim(),
    originalBranch: runSyncCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot }).stdout.trim(),
    targetMode,
    branchName: prepared.branchName,
    workDir: prepared.workDir,
    dirtyBeforeRun,
    stashRef: stashRef || null,
  }
}

function makeTempWorktreePath() {
  return path.join(os.tmpdir(), `uxl-diff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
}

async function generatePatch({
  config,
  overrides,
  prompt,
  resolveTargetStep,
  cleanupTarget,
  runSyncCommand,
  runCodex,
  runCopilot,
}) {
  const runner = (config.implement.runner || "codex").toLowerCase()
  const model = overrides.model || config.implement.model
  const reasoningEffort = overrides.reasoningEffort || config.implement.reasoningEffort
  const branch = `uxl-diff-${Date.now()}`
  const worktree = makeTempWorktreePath()
  const prepared = resolveTargetStep({
    repoRoot: config.paths.root,
    implementConfig: { ...config.implement, target: "worktree" },
    overrides: { ...overrides, target: "worktree", branch, worktree },
  })

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

    const patchText = runSyncCommand("git", ["diff", "--binary", "HEAD", "--"], { cwd: prepared.workDir }).stdout
    const diffStats = collectDiffStats(prepared.workDir, runSyncCommand)
    fs.mkdirSync(config.paths.diffsDir, { recursive: true })
    const patchPath = path.join(config.paths.diffsDir, buildTimestampedArtifactName("uxl_diff", "patch"))
    fs.writeFileSync(patchPath, patchText, "utf8")
    return {
      patchPath,
      diffStats,
      prepared,
    }
  } finally {
    cleanupTarget({
      repoRoot: config.paths.root,
      workDir: prepared.workDir,
      branchName: prepared.branchName,
    })
  }
}

export async function runImplement(args = [], cwd = process.cwd(), runtime = {}) {
  const startedAt = Date.now()
  const overrides = parseImplementArgs(args)
  const load = runtime.loadConfig || loadConfig
  const resolveTargetStep = runtime.resolveTarget || resolveTarget
  const previewTargetStep = runtime.previewTarget || previewTarget
  const cleanupTarget = runtime.cleanupWorktreeTarget || cleanupWorktreeTarget
  const ensureCommand = runtime.assertCommandAvailable || assertCommandAvailable
  const runCodex = runtime.runCodexImplement || runCodexImplement
  const runCopilot = runtime.runCopilotImplement || runCopilotImplement
  const runSyncCommand = runtime.runCommand || runCommand
  const writeArtifact = runtime.writeJsonArtifact || writeJsonArtifact
  const writeSnapshotFile = runtime.writeSnapshot || writeSnapshot
  const promptRuntime = runtime.prompt

  if (overrides.target !== undefined && !["current", "branch", "worktree"].includes(overrides.target)) {
    throw new Error(`Invalid --target: "${overrides.target}". Allowed: current, branch, worktree.`)
  }
  if (overrides.scope !== undefined && !["css-only", "text-only", "layout-safe", "unrestricted"].includes(overrides.scope)) {
    throw new Error(`Invalid --scope: "${overrides.scope}". Allowed: css-only, text-only, layout-safe, unrestricted.`)
  }

  const config = await load(cwd)
  const runner = (config.implement.runner || "codex").toLowerCase()
  validateReasoningEffort(overrides.reasoningEffort, "--reasoning-effort")
  if (!["codex", "copilot"].includes(runner)) {
    throw new Error(`Invalid implement.runner: "${runner}". Allowed: codex, copilot.`)
  }

  const bin = runner === "copilot" ? config.implement.copilot.bin : config.implement.codex.bin
  ensureCommand(bin)
  ensureInsideGitRepo(config.paths.root, runSyncCommand)

  const reportMarkdown = readReport(config.paths.reportPath)
  const prompt = await resolvePrompt({
    overrides,
    config,
    reportMarkdown,
    rootDir: config.paths.root,
  })
  const targetMode = overrides.target || config.implement.target
  const scope = overrides.scope || config.implement.scope || "layout-safe"
  const preview = previewTargetStep({
    repoRoot: config.paths.root,
    implementConfig: config.implement,
    overrides,
  })
  const dirty = isDirtyWorktree(config.paths.root, runSyncCommand)

  await confirmCurrentTarget({
    targetExplicit: overrides.target === "current",
    targetMode,
    isDirty: dirty,
    yes: overrides.yes,
    promptRuntime,
  })

  if (overrides.dryRun) {
    console.log(`${preview.summary} (dry-run)`)
    console.log("Dry run: prompt generated, but no implementation runner was executed.")
    console.log(prompt)
    return {
      status: "success",
      dryRun: true,
      scope,
      targetMode,
      summary: preview.summary,
      diffStats: { files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0 },
    }
  }

  if (overrides.diffOnly) {
    const diffResult = await generatePatch({
      config,
      overrides,
      prompt,
      resolveTargetStep,
      cleanupTarget,
      runSyncCommand,
      runCodex,
      runCopilot,
    })
    const reportJsonPath = writeArtifact({
      dir: config.paths.reportsDir || path.join(config.paths.root, ".uxl", "reports"),
      prefix: "uxl_report",
      payload: {
        timestamp: new Date().toISOString(),
        command: "diff",
        status: "success",
        duration_ms: Date.now() - startedAt,
        model: overrides.model || config.implement.model || null,
        scope,
        iteration: 1,
        steps: [
          {
            step: "implement",
            duration_ms: Date.now() - startedAt,
            files_changed: diffResult.diffStats.filesChanged,
            lines_added: diffResult.diffStats.linesAdded,
            lines_removed: diffResult.diffStats.linesRemoved,
            patch_path: diffResult.patchPath,
          },
        ],
      },
    })
    console.log(`Patch written: ${diffResult.patchPath}`)
    return {
      status: "success",
      diffOnly: true,
      patchPath: diffResult.patchPath,
      diffStats: diffResult.diffStats,
      reportJsonPath,
      scope,
      targetMode: "worktree",
    }
  }

  const prepared = resolveTargetStep({
    repoRoot: config.paths.root,
    implementConfig: config.implement,
    overrides,
  })

  let snapshotPath = null
  let stashRef = null
  const snapshotLabel = `uxl-snapshot-${Date.now()}`

  try {
    if (targetMode === "current" && dirty) {
      stashRef = stashDirtyCurrentTarget(config.paths.root, runSyncCommand, snapshotLabel)
    }

    snapshotPath = writeSnapshotFile(
      config.paths.snapshotsDir || path.join(config.paths.root, ".uxl", "snapshots"),
      createSnapshotMetadata({
        repoRoot: config.paths.root,
        prepared,
        targetMode,
        dirtyBeforeRun: dirty,
        stashRef,
        runSyncCommand,
      })
    )

    console.log(prepared.summary)
    if (runner === "copilot") {
      runCopilot({
        copilotBin: config.implement.copilot.bin,
        model: overrides.model || config.implement.model,
        timeoutMs: config.implement.timeoutMs,
        workDir: prepared.workDir,
        prompt,
      })
    } else {
      runCodex({
        codexBin: config.implement.codex.bin,
        model: overrides.model || config.implement.model,
        reasoningEffort: overrides.reasoningEffort || config.implement.reasoningEffort,
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

  const changedFiles = getChangedFiles(prepared.workDir, runSyncCommand)
  const diffStats = collectDiffStats(prepared.workDir, runSyncCommand)
  const scopeValidation = validateScopeAgainstFiles(changedFiles, scope)
  for (const message of [...scopeValidation.violations, ...scopeValidation.warnings]) {
    console.warn(message)
  }
  if (overrides.strict && (scopeValidation.violations.length > 0 || scopeValidation.warnings.length > 0)) {
    throw new Error(`Scope validation failed for ${scope}.`)
  }

  let committed = false
  if (config.implement.autoCommit) {
    committed = commitImplementedChanges(prepared.workDir, runSyncCommand)
  }

  const reportJsonPath = writeArtifact({
    dir: config.paths.reportsDir || path.join(config.paths.root, ".uxl", "reports"),
    prefix: "uxl_report",
    payload: {
      timestamp: new Date().toISOString(),
      command: "implement",
      status: "success",
      duration_ms: Date.now() - startedAt,
      model: overrides.model || config.implement.model || null,
      scope,
      iteration: 1,
      steps: [
        {
          step: "implement",
          duration_ms: Date.now() - startedAt,
          files_changed: diffStats.filesChanged,
          lines_added: diffStats.linesAdded,
          lines_removed: diffStats.linesRemoved,
          files: diffStats.files,
          scope_validation: scopeValidation,
          snapshot_path: snapshotPath,
        },
      ],
    },
  })

  console.log("UX implementation run completed.")
  if (config.implement.autoCommit) {
    console.log(committed ? "Changes committed automatically." : "Auto-commit enabled, but there were no changes to commit.")
  }
  if (targetMode === "worktree") {
    console.log(`Worktree path: ${prepared.workDir}`)
    console.log(`Branch: ${prepared.branchName}`)
  }

  return {
    status: "success",
    targetMode,
    scope,
    workDir: prepared.workDir,
    branchName: prepared.branchName,
    committed,
    snapshotPath,
    reportJsonPath,
    diffStats,
    scopeValidation,
  }
}
