import { loadConfig } from "../config/load-config.mjs"
import { assertCleanWorktree } from "../git/working-tree.mjs"
import { cleanupWorktreeTarget } from "../git/target-resolver.mjs"
import { listSnapshots, readSnapshot } from "../git/snapshots.mjs"
import { runCommand } from "../utils/process.mjs"

function parseRollbackArgs(args) {
  const values = {
    list: false,
    yes: false,
    to: null,
  }

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (token === "--list") {
      values.list = true
      continue
    }
    if (token === "--yes") {
      values.yes = true
      continue
    }
    if (token === "--to") {
      const next = args[i + 1]
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --to")
      }
      values.to = next
      i += 1
      continue
    }
    throw new Error(`Unknown flag: ${token}`)
  }

  return values
}

export async function runRollback(args = [], cwd = process.cwd(), runtime = {}) {
  const options = parseRollbackArgs(args)
  const load = runtime.loadConfig || loadConfig
  const runSyncCommand = runtime.runCommand || runCommand
  const config = await load(cwd)

  if (options.list) {
    const snapshots = listSnapshots(config.paths.snapshotsDir)
    if (snapshots.length === 0) {
      throw new Error(`No snapshots found in ${config.paths.snapshotsDir}.`)
    }
    for (const entry of snapshots) {
      console.log(
        `${entry.snapshot.createdAt}\t${entry.snapshot.targetMode}\t${entry.snapshot.branchName || "-"}\t${entry.path}`
      )
    }
    return {
      status: "success",
      listed: snapshots.length,
    }
  }

  if (!options.yes) {
    throw new Error("Rollback is destructive. Re-run with --yes to proceed.")
  }

  const { snapshot } = readSnapshot(config.paths.snapshotsDir, options.to)
  if (snapshot.targetMode === "worktree") {
    cleanupWorktreeTarget({
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
    assertCleanWorktree(snapshot.repoRoot, {
      runSyncCommand,
      label: "Rollback",
    })
    runSyncCommand("git", ["reset", "--hard", snapshot.head], { cwd: snapshot.repoRoot, stdio: "inherit" })
  }

  console.log(`Rolled back snapshot: ${snapshot.createdAt}`)
  return {
    status: "success",
    snapshot,
  }
}
