import fs from "fs"
import path from "path"
import { runCommand } from "../utils/process.mjs"

function sanitizeBranchName(name) {
  const cleaned = String(name || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9/_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!cleaned) {
    throw new Error("Could not derive a valid branch name.")
  }
  return cleaned
}

function template(value, vars) {
  return value.replace(/\{(timestamp|branchName|repoName|repoParent)\}/g, (_, key) => vars[key] || "")
}

function branchExists(repoRoot, name) {
  try {
    runCommand("git", ["show-ref", "--verify", `refs/heads/${name}`], { cwd: repoRoot })
    return true
  } catch {
    return false
  }
}

export function resolveTarget({ repoRoot, implementConfig, overrides = {} }) {
  runCommand("git", ["rev-parse", "--is-inside-work-tree"], { cwd: repoRoot })

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const repoName = path.basename(repoRoot)
  const repoParent = path.dirname(repoRoot)
  const target = overrides.target || implementConfig.target

  const branchNameRaw =
    overrides.branch ||
    template(implementConfig.branchNameTemplate, {
      timestamp,
      repoName,
      repoParent,
      branchName: "",
    })
  const branchName = sanitizeBranchName(branchNameRaw)

  const worktreePath = path.resolve(
    overrides.worktree ||
      template(implementConfig.worktreePathTemplate, {
        timestamp,
        repoName,
        repoParent,
        branchName,
      })
  )

  if (target === "current") {
    return {
      workDir: repoRoot,
      branchName,
      summary: `Target: current branch in ${repoRoot}`,
    }
  }

  if (target === "branch") {
    if (branchExists(repoRoot, branchName)) {
      runCommand("git", ["switch", branchName], { cwd: repoRoot, stdio: "inherit" })
    } else {
      runCommand("git", ["switch", "-c", branchName], { cwd: repoRoot, stdio: "inherit" })
    }
    return {
      workDir: repoRoot,
      branchName,
      summary: `Target: branch ${branchName} in current working tree`,
    }
  }

  if (fs.existsSync(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}. Use --worktree to override.`)
  }
  if (branchExists(repoRoot, branchName)) {
    throw new Error(`Branch ${branchName} already exists. Use --branch to override.`)
  }

  runCommand("git", ["worktree", "add", "-b", branchName, worktreePath], {
    cwd: repoRoot,
    stdio: "inherit",
  })

  return {
    workDir: worktreePath,
    branchName,
    summary: `Target: worktree ${worktreePath} on branch ${branchName}`,
  }
}
