import fs from "fs"
import { assertCleanWorktree } from "./working-tree.mjs"
import { cleanupWorktreeTarget } from "./target-resolver.mjs"
import { runCommand } from "../utils/process.mjs"

// Restore the working state to a snapshot's recorded pre-implement state, per
// target mode. Shared by `uxl rollback` and the keep-best gate in `uxl run`.
export function restoreSnapshot({ snapshot, runtime = {}, label = "Restore" }) {
  const runSyncCommand = runtime.runCommand || runCommand
  const cleanupTarget = runtime.cleanupTarget || cleanupWorktreeTarget

  if (snapshot.targetMode === "worktree") {
    cleanupTarget({
      repoRoot: snapshot.repoRoot,
      workDir: snapshot.workDir,
      branchName: snapshot.branchName,
    })
  } else if (snapshot.targetMode === "branch") {
    runSyncCommand("git", ["switch", snapshot.originalBranch], { cwd: snapshot.repoRoot, stdio: "inherit" })
    if (snapshot.branchName) {
      try {
        runSyncCommand("git", ["branch", "-d", snapshot.branchName], { cwd: snapshot.repoRoot })
      } catch {
        console.warn(`Warning: could not delete branch ${snapshot.branchName} (may have unmerged changes or already be deleted).`)
      }
    }
  } else {
    assertCleanWorktree(snapshot.repoRoot, { runSyncCommand, label })
    runSyncCommand("git", ["reset", "--hard", snapshot.head], { cwd: snapshot.repoRoot, stdio: "inherit" })
  }

  return snapshot
}

// Path wrapper used by the keep-best gate, which only has a snapshot file path.
export function restoreToSnapshot({ snapshotPath, runtime = {}, label = "Keep-best restore" }) {
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"))
  return restoreSnapshot({ snapshot, runtime, label })
}
