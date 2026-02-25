#!/usr/bin/env node
import { runFlows } from "./commands/flows.mjs"
import { runImplement } from "./commands/implement.mjs"
import { runInit } from "./commands/init.mjs"
import { runPipeline } from "./commands/run.mjs"
import { runReview } from "./commands/review.mjs"
import { runShots } from "./commands/shots.mjs"
import { resolveWorkspaceCwd } from "./utils/workspace-cwd.mjs"

function printHelp() {
  console.log(`uxl - UX loop CLI

Usage:
  uxl init [--preset=playwright-vite] [--force] [--non-interactive]
  uxl flows <list|add|map|check|import-playwright> [...flags]
  uxl shots
  uxl review [--runner codex|openai] [--model <name>]
  uxl implement [--target current|branch|worktree] [--branch <name>] [--worktree <path>] [--model <name>]
  uxl run [review/implement flags]
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
      await runShots(workspaceCwd)
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

    if (command === "run") {
      await runPipeline(args, workspaceCwd)
      return
    }

    throw new Error(`Unknown command: ${command}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
