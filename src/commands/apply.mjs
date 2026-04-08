import fs from "fs"
import path from "path"
import { loadConfig } from "../config/load-config.mjs"
import { assertCommandAvailable, runCommand } from "../utils/process.mjs"

function parsePatchFilePaths(patchText) {
  const files = new Set()
  for (const line of patchText.split("\n")) {
    const match = line.match(/^\+\+\+ b\/(.+)$/)
    if (match && match[1] !== "/dev/null") {
      files.add(match[1])
    }
  }
  return [...files]
}

function parseApplyArgs(args) {
  const values = {
    commit: false,
    patchPath: null,
  }

  for (const token of args) {
    if (token === "--commit") {
      values.commit = true
      continue
    }
    if (token.startsWith("--")) {
      throw new Error(`Unknown flag: ${token}`)
    }
    if (values.patchPath) {
      throw new Error(`Unexpected positional argument: ${token}`)
    }
    values.patchPath = token
  }

  return values
}

function findLatestPatch(diffsDir) {
  if (!fs.existsSync(diffsDir)) {
    throw new Error(`No diff artifacts found in ${diffsDir}.`)
  }
  const matches = fs
    .readdirSync(diffsDir)
    .filter((entry) => /^uxl_diff_\d{4}-\d{2}-\d{2}_\d+\.patch$/.test(entry))
    .map((entry) => path.join(diffsDir, entry))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)

  if (matches.length === 0) {
    throw new Error(`No diff artifacts found in ${diffsDir}.`)
  }
  return matches[0]
}

export async function runApply(args = [], cwd = process.cwd(), runtime = {}) {
  const { commit, patchPath } = parseApplyArgs(args)
  const load = runtime.loadConfig || loadConfig
  const runSyncCommand = runtime.runCommand || runCommand
  const ensureCommand = runtime.assertCommandAvailable || assertCommandAvailable
  const config = await load(cwd)
  ensureCommand("git")

  const resolvedPatchPath = patchPath ? path.resolve(cwd, patchPath) : findLatestPatch(config.paths.diffsDir)
  if (!fs.existsSync(resolvedPatchPath)) {
    throw new Error(`Patch not found: ${resolvedPatchPath}`)
  }

  runSyncCommand("git", ["apply", "--check", resolvedPatchPath], { cwd: config.paths.root })
  runSyncCommand("git", ["apply", resolvedPatchPath], { cwd: config.paths.root })

  if (commit) {
    const patchText = fs.readFileSync(resolvedPatchPath, "utf8")
    const patchedFiles = parsePatchFilePaths(patchText)
    if (patchedFiles.length > 0) {
      runSyncCommand("git", ["add", "--", ...patchedFiles], { cwd: config.paths.root, stdio: "inherit" })
    }
    runSyncCommand("git", ["commit", "-m", "chore: apply ux loop patch"], {
      cwd: config.paths.root,
      stdio: "inherit",
    })
  }

  console.log(`Applied patch: ${resolvedPatchPath}`)
  return {
    status: "success",
    patchPath: resolvedPatchPath,
    committed: commit,
  }
}
