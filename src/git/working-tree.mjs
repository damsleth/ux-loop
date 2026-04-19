import { runCommand } from "../utils/process.mjs"

export function isWorktreeDirty(repoRoot, runSyncCommand = runCommand) {
  return Boolean(runSyncCommand("git", ["status", "--porcelain"], { cwd: repoRoot }).stdout.trim())
}

export function assertCleanWorktree(repoRoot, { runSyncCommand = runCommand, label = "This operation" } = {}) {
  if (isWorktreeDirty(repoRoot, runSyncCommand)) {
    throw new Error(`${label} requires a clean working tree. Commit or stash your changes first.`)
  }
}
