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

test("runRollback rejects dirty current-target rollback before reset", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-rollback-current-dirty-"))
  const commands = []

  try {
    writeSnapshot(dir, {
      createdAt: "2026-01-01T10:00:00Z",
      targetMode: "current",
      branchName: "main",
      workDir: dir,
      repoRoot: dir,
      head: "abc",
      originalBranch: "main",
    })

    await assert.rejects(
      () =>
        runRollback(["--yes"], "/tmp", {
          loadConfig: async () => makeConfig(dir),
          runCommand: (_cmd, args) => {
            commands.push(args.join(" "))
            if (args[0] === "status") return { stdout: " M src/app.js\n" }
            return { stdout: "" }
          },
        }),
      /clean working tree/
    )

    assert.deepEqual(commands, ["status --porcelain"])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("runRollback hard-resets clean current-target snapshots", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-rollback-current-clean-"))
  const commands = []

  try {
    writeSnapshot(dir, {
      createdAt: "2026-01-01T10:00:00Z",
      targetMode: "current",
      branchName: "main",
      workDir: dir,
      repoRoot: dir,
      head: "abc123",
      originalBranch: "main",
    })

    const result = await runRollback(["--yes"], "/tmp", {
      loadConfig: async () => makeConfig(dir),
      runCommand: (_cmd, args) => {
        commands.push(args.join(" "))
        if (args[0] === "status") return { stdout: "" }
        return { stdout: "" }
      },
    })

    assert.equal(result.status, "success")
    assert.deepEqual(commands, ["status --porcelain", "reset --hard abc123"])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("runRollback worktree uses runtime.cleanupTarget when provided", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-rollback-worktree-inject-"))
  const cleanupCalls = []
  const gitCalls = []

  try {
    writeSnapshot(dir, {
      createdAt: "2026-01-01T10:00:00Z",
      targetMode: "worktree",
      branchName: "uxl-wt",
      workDir: "/tmp/uxl-wt",
      repoRoot: dir,
      head: "abc123",
      originalBranch: "main",
    })

    const result = await runRollback(["--yes"], "/tmp", {
      loadConfig: async () => makeConfig(dir),
      runCommand: (_cmd, args) => {
        gitCalls.push(args.join(" "))
        return { stdout: "" }
      },
      cleanupTarget: (payload) => {
        cleanupCalls.push(payload)
      },
    })

    assert.equal(result.status, "success")
    assert.equal(cleanupCalls.length, 1)
    assert.deepEqual(cleanupCalls[0], {
      repoRoot: dir,
      workDir: "/tmp/uxl-wt",
      branchName: "uxl-wt",
    })
    assert.deepEqual(gitCalls, [])
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
