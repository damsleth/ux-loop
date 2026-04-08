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
  return String(value || "").replace(/\{(timestamp|branchName|repoName|repoParent)\}/g, (_, key) => vars[key] || "")
}

function branchExists(repoRoot, name) {
  try {
    runCommand("git", ["show-ref", "--verify", `refs/heads/${name}`], { cwd: repoRoot })
    return true
  } catch {
    return false
  }
}

const VALID_TARGETS = ["current", "branch", "worktree"]

export function previewTarget({ repoRoot, implementConfig, overrides = {} }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const repoName = path.basename(repoRoot)
  const repoParent = path.dirname(repoRoot)
  const target = overrides.target || implementConfig.target

  if (!VALID_TARGETS.includes(target)) {
    throw new Error(`Invalid implement.target: "${target}". Allowed: current, branch, worktree.`)
  }

  const branchNameRaw =
    overrides.branch ||
    template(implementConfig.branchNameTemplate || "uxl-{timestamp}", {
      timestamp,
      repoName,
      repoParent,
      branchName: "",
    })
  const branchName = sanitizeBranchName(branchNameRaw)

  const worktreePath = path.resolve(
    overrides.worktree ||
      template(implementConfig.worktreePathTemplate || "{repoParent}/{repoName}-{branchName}", {
        timestamp,
        repoName,
        repoParent,
        branchName,
      })
  )

  if (target === "current") {
    return {
      target,
      workDir: repoRoot,
      branchName,
      summary: `Target: current branch in ${repoRoot}`,
    }
  }

  if (target === "branch") {
    return {
      target,
      workDir: repoRoot,
      branchName,
      summary: `Target: branch ${branchName} in current working tree`,
    }
  }

  return {
    target,
    workDir: worktreePath,
    branchName,
    summary: `Target: worktree ${worktreePath} on branch ${branchName}`,
  }
}

export function resolveTarget({ repoRoot, implementConfig, overrides = {} }) {
  runCommand("git", ["rev-parse", "--is-inside-work-tree"], { cwd: repoRoot })
  const preview = previewTarget({ repoRoot, implementConfig, overrides })

  if (preview.target === "current") {
    return preview
  }

  if (preview.target === "branch") {
    if (branchExists(repoRoot, preview.branchName)) {
      runCommand("git", ["switch", preview.branchName], { cwd: repoRoot, stdio: "inherit" })
    } else {
      runCommand("git", ["switch", "-c", preview.branchName], { cwd: repoRoot, stdio: "inherit" })
    }
    return {
      workDir: repoRoot,
      branchName: preview.branchName,
      summary: preview.summary,
    }
  }

  if (fs.existsSync(preview.workDir)) {
    throw new Error(`Worktree path already exists: ${preview.workDir}. Use --worktree to override.`)
  }
  if (branchExists(repoRoot, preview.branchName)) {
    throw new Error(`Branch ${preview.branchName} already exists. Use --branch to override.`)
  }

  runCommand("git", ["worktree", "add", "-b", preview.branchName, preview.workDir], {
    cwd: repoRoot,
    stdio: "inherit",
  })

  return {
    workDir: preview.workDir,
    branchName: preview.branchName,
    summary: preview.summary,
  }
}

export function cleanupWorktreeTarget({ repoRoot, workDir, branchName }) {
  const failures = []

  try {
    runCommand("git", ["worktree", "remove", "--force", workDir], { cwd: repoRoot })
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  }

  try {
    runCommand("git", ["branch", "-D", branchName], { cwd: repoRoot })
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  }

  if (failures.length > 0) {
    throw new Error(`Failed to clean up worktree target: ${failures.join(" | ")}`)
  }
}

export function getCurrentBranch(repoRoot) {
  return runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot }).stdout.trim()
}
