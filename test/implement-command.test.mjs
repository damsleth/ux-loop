import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { resolveReportInputPath, runImplement } from "../src/commands/implement.mjs"
import { resolveReportOutputPath } from "../src/commands/review.mjs"

test("resolveReportInputPath prefers existing report.md over timestamped files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-implement-report-"))
  const reportPath = path.join(dir, "report.md")
  const older = path.join(dir, "uxl_report_2026-01-01_1000.md")

  fs.writeFileSync(reportPath, "current", "utf8")
  fs.writeFileSync(older, "older", "utf8")

  assert.equal(resolveReportInputPath(reportPath), reportPath)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("resolveReportInputPath falls back to latest timestamped report when report.md is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-implement-report-"))
  const reportPath = path.join(dir, "report.md")
  const older = path.join(dir, "uxl_report_2026-01-01_1000.md")
  const newer = path.join(dir, "uxl_report_2026-01-01_1015.md")

  fs.writeFileSync(older, "older", "utf8")
  fs.writeFileSync(newer, "newer", "utf8")

  assert.equal(resolveReportInputPath(reportPath), newer)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("resolveReportOutputPath uses millisecond precision to avoid collisions", () => {
  const reportPath = "/tmp/report.md"
  const left = resolveReportOutputPath(reportPath, new Date("2026-01-01T10:15:00.001Z"))
  const right = resolveReportOutputPath(reportPath, new Date("2026-01-01T10:15:00.999Z"))

  assert.notEqual(left, right)
})

test("runImplement rejects invalid --target with enum-style error before any git side effects", async () => {
  const resolveTargetCalled = { called: false }

  await assert.rejects(
    () =>
      runImplement(["--target", "banana"], process.cwd(), {
        loadConfig: async () => ({
          paths: { root: process.cwd(), reportPath: "/nonexistent/report.md" },
          implement: {
            runner: "codex",
            target: "current",
            autoCommit: false,
            timeoutMs: 1000,
            codex: { bin: "codex" },
            copilot: { bin: "copilot" },
          },
        }),
        assertCommandAvailable: () => {},
        resolveTarget: () => {
          resolveTargetCalled.called = true
          return { workDir: process.cwd(), branchName: "main", summary: "" }
        },
        runCodexImplement: () => {},
        runCommand: () => ({ stdout: "" }),
      }),
    (err) => {
      assert.ok(err instanceof Error)
      assert.ok(err.message.includes("banana"), `expected "banana" in: ${err.message}`)
      assert.ok(
        err.message.includes("current") && err.message.includes("branch") && err.message.includes("worktree"),
        `expected allowed values in: ${err.message}`
      )
      assert.equal(resolveTargetCalled.called, false, "resolveTarget must not be called for invalid target")
      return true
    }
  )
})

test("runImplement dry-run does not invoke LLM runner", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-dryrun-"))
  const reportPath = path.join(dir, "report.md")
  fs.writeFileSync(reportPath, "# report", "utf8")

  let runnerCalled = false

  try {
    const result = await runImplement(["--dry-run", "--yes"], dir, {
      loadConfig: async () => ({
        paths: { root: dir, reportPath },
        implement: {
          runner: "codex",
          target: "current",
          autoCommit: false,
          timeoutMs: 1000,
          codex: { bin: "codex" },
          copilot: { bin: "copilot" },
        },
      }),
      assertCommandAvailable: () => {},
      previewTarget: () => ({ summary: "Target: current branch" }),
      resolveTarget: () => ({ workDir: dir, branchName: null, summary: "Target: current branch" }),
      runCodexImplement: () => { runnerCalled = true },
      runCommand: () => ({ stdout: "" }),
    })

    assert.equal(runnerCalled, false, "LLM runner must not be invoked in dry-run mode")
    assert.equal(result.dryRun, true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("runImplement throws when target is current, worktree is dirty, and --yes is not passed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-dirty-"))
  const reportPath = path.join(dir, "report.md")
  fs.writeFileSync(reportPath, "# report", "utf8")

  try {
    await assert.rejects(
      () =>
        runImplement(["--target", "current"], dir, {
          loadConfig: async () => ({
            paths: { root: dir, reportPath },
            implement: {
              runner: "codex",
              target: "current",
              autoCommit: false,
              timeoutMs: 1000,
              codex: { bin: "codex" },
              copilot: { bin: "copilot" },
            },
          }),
          assertCommandAvailable: () => {},
          previewTarget: () => ({ summary: "Target: current branch" }),
          resolveTarget: () => ({ workDir: dir, branchName: null, summary: "Target: current branch" }),
          runCodexImplement: () => {},
          runCommand: (_cmd, args) => {
            if (args[0] === "status") return { stdout: " M src/app.js\n" }
            return { stdout: "" }
          },
        }),
      (err) => {
        assert.ok(err instanceof Error)
        assert.ok(err.message.toLowerCase().includes("uncommitted") || err.message.toLowerCase().includes("dirty"), `expected dirty-worktree error, got: ${err.message}`)
        return true
      }
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("runImplement fails hard when not inside a git repo", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-nogit-"))
  const reportPath = path.join(dir, "report.md")
  fs.writeFileSync(reportPath, "# report", "utf8")

  try {
    await assert.rejects(
      () =>
        runImplement([], dir, {
          loadConfig: async () => ({
            paths: { root: dir, reportPath },
            implement: {
              runner: "codex",
              target: "worktree",
              autoCommit: false,
              timeoutMs: 1000,
              codex: { bin: "codex" },
              copilot: { bin: "copilot" },
            },
          }),
          assertCommandAvailable: () => {},
          runCommand: (_cmd, args) => {
            if (args[0] === "rev-parse") throw new Error("not a git repository")
            return { stdout: "" }
          },
        }),
      (err) => {
        assert.ok(err instanceof Error)
        return true
      }
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("runImplement auto-commits when enabled", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-implement-auto-commit-"))
  const reportPath = path.join(dir, "report.md")
  fs.writeFileSync(reportPath, "# report", "utf8")

  const commands = []

  try {
    await runImplement(["--yes"], dir, {
      loadConfig: async () => ({
        paths: { root: dir, reportPath },
        implement: {
          runner: "codex",
          target: "current",
          autoCommit: true,
          timeoutMs: 1000,
          codex: { bin: "codex" },
          copilot: { bin: "copilot" },
        },
      }),
      assertCommandAvailable: () => {},
      resolveTarget: () => ({ workDir: dir, branchName: "main", summary: "Target: current branch" }),
      runCodexImplement: () => {},
      runCommand: (command, args) => {
        commands.push([command, ...args].join(" "))
        if (args[0] === "status") return { stdout: " M src/app.js\n" }
        if (args[0] === "diff") return { stdout: "src/app.js\n" }
        return { stdout: "" }
      },
    })

    assert.deepEqual(commands.slice(-4), [
      "git status --porcelain",
      "git add -A",
      "git diff --cached --name-only",
      "git commit -m chore: apply ux loop improvements",
    ])
    assert.ok(commands.includes("git rev-parse --is-inside-work-tree"))
    assert.ok(commands.some((entry) => entry.startsWith("git rev-parse HEAD")))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
