#!/usr/bin/env node
import { runApply } from "./commands/apply.mjs"
import { runDiff } from "./commands/diff.mjs"
import { runFlows } from "./commands/flows.mjs"
import { runImplement } from "./commands/implement.mjs"
import { runInit } from "./commands/init.mjs"
import { runPipeline } from "./commands/run.mjs"
import { runReport } from "./commands/report.mjs"
import { runReview } from "./commands/review.mjs"
import { runRollback } from "./commands/rollback.mjs"
import { runShots } from "./commands/shots.mjs"
import { resolveWorkspaceCwd } from "./utils/workspace-cwd.mjs"

function printHelp() {
  console.log(`uxl - UX loop CLI

Usage:
  uxl init [--preset=playwright-vite] [--force] [--non-interactive]
  uxl flows <list|add|map|check|validate|import-playwright> [...flags]
  uxl shots [--no-limits]
  uxl review [--runner codex|copilot|openai] [--model <name>] [--reasoning-effort low|medium|high|extraHigh] [--image-detail low|auto|high] [--prompt-file <path>] [--style <preset-or-file>] [--no-limits]
  uxl implement [--target current|branch|worktree] [--branch <name>] [--worktree <path>] [--scope css-only|text-only|layout-safe|unrestricted] [--model <name>] [--reasoning-effort low|medium|high|extraHigh] [--prompt-file <path>] [--style <preset-or-file>] [--strict] [--yes] [--dry-run] [--diff-only] [--no-limits]
  uxl diff [implement flags]
  uxl apply [<patch-path>] [--commit]
  uxl rollback [--list] [--to <timestamp>] [--yes]
  uxl report [--left <report.json> --right <report.json>]
  uxl run [--iterations <1-10>] [--score-threshold <1-100>] [review/implement/shots flags]
`)
}

async function main() {
  const [, , command, ...args] = process.argv
  const workspaceCwd = resolveWorkspaceCwd()

  try {
    if (!command || command === "--help" || command === "-h") {
      printHelp()
      return
    }

    if (command === "init") {
      const result = await runInit(args, workspaceCwd)
      console.log(`Created: ${result.configPath}`)
      if (result.warnings.length > 0) {
        for (const warning of result.warnings) {
          console.log(`Warning: ${warning}`)
        }
      }
      return
    }

    if (command === "flows") {
      await runFlows(args, workspaceCwd)
      return
    }

    if (command === "shots") {
      await runShots(args, workspaceCwd)
      return
    }

    if (command === "review") {
      await runReview(args, workspaceCwd)
      return
    }

    if (command === "implement") {
      await runImplement(args, workspaceCwd)
      return
    }

    if (command === "diff") {
      await runDiff(args, workspaceCwd)
      return
    }

    if (command === "apply") {
      await runApply(args, workspaceCwd)
      return
    }

    if (command === "rollback") {
      await runRollback(args, workspaceCwd)
      return
    }

    if (command === "report") {
      await runReport(args, workspaceCwd)
      return
    }

    if (command === "run") {
      const result = await runPipeline(args, workspaceCwd)
      if (result?.exitState === "failed") {
        process.exitCode = 1
      }
      return
    }

    printHelp()
    throw new Error(`Unknown command: ${command}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
