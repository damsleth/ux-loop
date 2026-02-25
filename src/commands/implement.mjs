import fs from "fs"
import { loadConfig } from "../config/load-config.mjs"
import { resolveTarget } from "../git/target-resolver.mjs"
import { buildDefaultImplementPrompt } from "../prompts/default-implement-prompt.mjs"
import { runCodexImplement } from "../runners/implement-codex.mjs"
import { assertCommandAvailable } from "../utils/process.mjs"

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
  }
  return values
}

function readReport(reportPath) {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Report not found: ${reportPath}. Run \`uxl review\` first.`)
  }
  const text = fs.readFileSync(reportPath, "utf8").trim()
  if (!text) {
    throw new Error(`Report is empty: ${reportPath}. Run \`uxl review\` first.`)
  }
  return text
}

export async function runImplement(args = []) {
  const overrides = parseImplementArgs(args)
  const config = await loadConfig()
  assertCommandAvailable(config.implement.codex.bin)

  const reportMarkdown = readReport(config.paths.reportPath)
  const prepared = resolveTarget({
    repoRoot: config.paths.root,
    implementConfig: config.implement,
    overrides,
  })

  const prompt = buildDefaultImplementPrompt(reportMarkdown)
  const model = overrides.model || config.implement.model

  console.log(prepared.summary)
  runCodexImplement({
    codexBin: config.implement.codex.bin,
    model,
    workDir: prepared.workDir,
    prompt,
  })

  console.log("UX implementation run completed.")
  if ((overrides.target || config.implement.target) === "worktree") {
    console.log(`Worktree path: ${prepared.workDir}`)
    console.log(`Branch: ${prepared.branchName}`)
  }
}
