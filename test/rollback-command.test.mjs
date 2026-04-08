import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { runRollback } from "../src/commands/rollback.mjs"
import { writeSnapshot } from "../src/git/snapshots.mjs"

function makeConfig(snapshotsDir) {
  return {
    paths: { snapshotsDir },
  }
}

function makeRuntime(snapshotsDir, gitResponses = {}) {
  return {
    loadConfig: async () => makeConfig(snapshotsDir),
    runCommand: (_cmd, args) => {
      const key = args.join(" ")
      if (key in gitResponses) return gitResponses[key]
      return { stdout: "" }
    },
  }
}

test("runRollback --list shows available snapshots", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-rollback-list-"))
  try {
    writeSnapshot(dir, { createdAt: "2026-01-01T10:00:00Z", targetMode: "worktree", branchName: "uxl-1", workDir: dir, repoRoot: dir, head: "abc", originalBranch: "main", dirtyBeforeRun: false, stashRef: null })
    writeSnapshot(dir, { createdAt: "2026-01-01T11:00:00Z", targetMode: "branch", branchName: "uxl-2", workDir: dir, repoRoot: dir, head: "def", originalBranch: "main", dirtyBeforeRun: false, stashRef: null })

    const result = await runRollback(["--list"], "/tmp", makeRuntime(dir))

    assert.equal(result.status, "success")
    assert.equal(result.listed, 2)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("runRollback --list throws with clear error when no snapshots exist", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-rollback-empty-"))
  try {
    await assert.rejects(
      () => runRollback(["--list"], "/tmp", makeRuntime(dir)),
      (err) => {
        assert.ok(err instanceof Error)
        assert.ok(err.message.toLowerCase().includes("no snapshots"), `expected "no snapshots" in: ${err.message}`)
        return true
      }
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("runRollback without --yes throws before doing anything", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-rollback-noyes-"))
  try {
    writeSnapshot(dir, { createdAt: "2026-01-01T10:00:00Z", targetMode: "worktree", branchName: "uxl-1", workDir: dir, repoRoot: dir, head: "abc", originalBranch: "main", dirtyBeforeRun: false, stashRef: null })

    await assert.rejects(
      () => runRollback([], "/tmp", makeRuntime(dir)),
      (err) => {
        assert.ok(err instanceof Error)
        assert.ok(err.message.toLowerCase().includes("--yes"), `expected "--yes" in: ${err.message}`)
        return true
      }
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("snapshot rotation keeps at most 20 entries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-snapshot-rotation-"))
  try {
    for (let i = 0; i < 22; i += 1) {
      const date = new Date(2026, 0, 1, 12, 0, 0, i * 10)
      writeSnapshot(dir, { createdAt: date.toISOString(), targetMode: "worktree", branchName: `uxl-${i}`, workDir: dir, repoRoot: dir, head: "abc", originalBranch: "main", dirtyBeforeRun: false, stashRef: null }, date)
    }
    const entries = fs.readdirSync(dir).filter((f) => f.startsWith("uxl_snapshot_"))
    assert.equal(entries.length, 20, `expected 20 snapshots after rotation, got ${entries.length}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
