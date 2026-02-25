import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { resolveTarget } from "../src/git/target-resolver.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, "..")

const BASE_CONFIG = {
  target: "current",
  branchNameTemplate: "uxl-{timestamp}",
  worktreePathTemplate: "{repoParent}/{repoName}-{branchName}",
}

test("resolveTarget(current) returns repo root as workDir", () => {
  const result = resolveTarget({
    repoRoot: REPO_ROOT,
    implementConfig: BASE_CONFIG,
    overrides: {},
  })

  assert.equal(result.workDir, REPO_ROOT)
  assert.ok(result.branchName.startsWith("uxl-"))
  assert.ok(result.summary.includes("current branch"))
})

test("resolveTarget uses --branch override as branch name", () => {
  const result = resolveTarget({
    repoRoot: REPO_ROOT,
    implementConfig: BASE_CONFIG,
    overrides: { branch: "my-custom-branch" },
  })

  assert.equal(result.branchName, "my-custom-branch")
})

test("resolveTarget sanitizes special characters out of branch names", () => {
  const result = resolveTarget({
    repoRoot: REPO_ROOT,
    implementConfig: BASE_CONFIG,
    overrides: { branch: "fix: spaces & special!! chars" },
  })

  assert.ok(!result.branchName.includes(" "))
  assert.ok(!result.branchName.includes(":"))
  assert.ok(!result.branchName.includes("&"))
  assert.ok(!result.branchName.includes("!"))
  assert.ok(result.branchName.length > 0)
})

test("resolveTarget throws when path is not inside a git repository", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-not-git-"))
  try {
    assert.throws(
      () =>
        resolveTarget({
          repoRoot: tmpDir,
          implementConfig: BASE_CONFIG,
          overrides: {},
        }),
      /failed/
    )
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})
