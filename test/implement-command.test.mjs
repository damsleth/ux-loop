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
        assert.ok(err.message.toLowerCase().includes("clean working tree"), `expected clean-worktree error, got: ${err.message}`)
        return true
      }
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("runImplement still rejects dirty current target when --yes is passed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-dirty-current-yes-"))
  const reportPath = path.join(dir, "report.md")
  fs.writeFileSync(reportPath, "# report", "utf8")

  try {
    await assert.rejects(
      () =>
        runImplement(["--target", "current", "--yes"], dir, {
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
      /clean working tree/
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("runImplement rejects dirty branch target before switching branches", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-dirty-branch-"))
  const reportPath = path.join(dir, "report.md")
  fs.writeFileSync(reportPath, "# report", "utf8")

  let resolveTargetCalled = false

  try {
    await assert.rejects(
      () =>
        runImplement(["--target", "branch"], dir, {
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
          previewTarget: () => ({ summary: "Target: branch uxl-test in current working tree" }),
          resolveTarget: () => {
            resolveTargetCalled = true
            return { workDir: dir, branchName: "uxl-test", summary: "Target: branch uxl-test in current working tree" }
          },
          runCodexImplement: () => {},
          runCommand: (_cmd, args) => {
            if (args[0] === "status") return { stdout: " M src/app.js\n" }
            return { stdout: "" }
          },
        }),
      /clean working tree/
    )

    assert.equal(resolveTargetCalled, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("runImplement restores the original branch and deletes empty generated branches on branch-target failure", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-branch-failure-cleanup-"))
  const reportPath = path.join(dir, "report.md")
  fs.writeFileSync(reportPath, "# report", "utf8")

  const commands = []
  let currentBranch = "main"

  try {
    await assert.rejects(
      () =>
        runImplement(["--target", "branch"], dir, {
          loadConfig: async () => ({
            paths: { root: dir, reportPath, snapshotsDir: path.join(dir, ".uxl", "snapshots") },
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
          resolveTarget: () => {
            currentBranch = "uxl-branch"
            return {
              workDir: dir,
              branchName: "uxl-branch",
              summary: "Target: branch uxl-branch in current working tree",
            }
          },
          runCodexImplement: () => {
            throw new Error("runner failed")
          },
          runCommand: (_cmd, args) => {
            commands.push(args.join(" "))
            const key = args.join(" ")
            if (key === "rev-parse --is-inside-work-tree") return { stdout: "true\n" }
            if (key === "rev-parse HEAD") return { stdout: "abc123\n" }
            if (key === "rev-parse --abbrev-ref HEAD") return { stdout: `${currentBranch}\n` }
            if (key === "status --porcelain") return { stdout: "" }
            if (key === "switch main") {
              currentBranch = "main"
              return { stdout: "" }
            }
            return { stdout: "" }
          },
        }),
      /runner failed/
    )

    assert.ok(commands.includes("reset --hard abc123"))
    assert.ok(commands.includes("switch main"))
    assert.ok(commands.includes("branch -d uxl-branch"))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("runImplement restores the original branch after strict scope failures in branch mode", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-branch-strict-cleanup-"))
  const reportPath = path.join(dir, "report.md")
  fs.writeFileSync(reportPath, "# report", "utf8")

  const commands = []
  let currentBranch = "main"

  try {
    await assert.rejects(
      () =>
        runImplement(["--target", "branch", "--strict"], dir, {
          loadConfig: async () => ({
            paths: { root: dir, reportPath, snapshotsDir: path.join(dir, ".uxl", "snapshots") },
            implement: {
              runner: "codex",
              target: "worktree",
              scope: "layout-safe",
              autoCommit: false,
              timeoutMs: 1000,
              codex: { bin: "codex" },
              copilot: { bin: "copilot" },
            },
          }),
          assertCommandAvailable: () => {},
          resolveTarget: () => {
            currentBranch = "uxl-branch"
            return {
              workDir: dir,
              branchName: "uxl-branch",
              summary: "Target: branch uxl-branch in current working tree",
            }
          },
          runCodexImplement: () => {},
          runCommand: (_cmd, args) => {
            commands.push(args.join(" "))
            const key = args.join(" ")
            if (key === "rev-parse --is-inside-work-tree") return { stdout: "true\n" }
            if (key === "rev-parse HEAD") return { stdout: "abc123\n" }
            if (key === "rev-parse --abbrev-ref HEAD") return { stdout: `${currentBranch}\n` }
            if (key === "status --porcelain") return { stdout: "" }
            if (key === "switch main") {
              currentBranch = "main"
              return { stdout: "" }
            }
            if (key === "diff --name-only HEAD --") return { stdout: "src/app.js\n" }
            if (key === "diff --numstat HEAD --") return { stdout: "1\t0\tsrc/app.js\n" }
            if (key === "ls-files --others --exclude-standard") return { stdout: "" }
            return { stdout: "" }
          },
        }),
      /Scope validation failed/
    )

    assert.ok(commands.includes("switch main"))
    assert.ok(commands.includes("branch -d uxl-branch"))
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
  let statusCalls = 0

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
        if (args[0] === "status") {
          statusCalls += 1
          return { stdout: statusCalls === 1 ? "" : " M src/app.js\n" }
        }
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

test("runImplement includes untracked files in diff stats and scope validation", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-implement-untracked-"))
  const reportPath = path.join(dir, "report.md")
  const snapshotsDir = path.join(dir, ".uxl", "snapshots")
  fs.mkdirSync(snapshotsDir, { recursive: true })
  fs.mkdirSync(path.join(dir, "src"), { recursive: true })
  fs.writeFileSync(reportPath, "# report", "utf8")
  fs.writeFileSync(path.join(dir, "src", "new-logic.js"), "console.log('new logic')\n", "utf8")

  try {
    const result = await runImplement(["--target", "current", "--yes"], dir, {
      loadConfig: async () => ({
        paths: { root: dir, reportPath, snapshotsDir, reportsDir: path.join(dir, ".uxl", "reports") },
        implement: {
          runner: "codex",
          target: "current",
          scope: "layout-safe",
          autoCommit: false,
          timeoutMs: 1000,
          codex: { bin: "codex" },
          copilot: { bin: "copilot" },
        },
      }),
      assertCommandAvailable: () => {},
      resolveTarget: () => ({ workDir: dir, branchName: "main", summary: "Target: current branch" }),
      runCodexImplement: () => {},
      runCommand: (_cmd, args) => {
        const key = args.join(" ")
        if (key === "rev-parse --is-inside-work-tree") return { stdout: "true\n" }
        if (key === "status --porcelain") return { stdout: "" }
        if (key === "rev-parse HEAD") return { stdout: "abc123\n" }
        if (key === "rev-parse --abbrev-ref HEAD") return { stdout: "main\n" }
        if (key === "diff --name-only HEAD --") return { stdout: "" }
        if (key === "diff --numstat HEAD --") return { stdout: "" }
        if (key === "ls-files --others --exclude-standard") return { stdout: "src/new-logic.js\n" }
        return { stdout: "" }
      },
    })

    assert.deepEqual(result.diffStats.files, ["src/new-logic.js"])
    assert.equal(result.diffStats.filesChanged, 1)
    assert.equal(result.diffStats.linesAdded, 1)
    assert.match(result.scopeValidation.violations[0], /layout-safe/)
    assert.match(result.scopeValidation.violations[0], /src\/new-logic\.js/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("runImplement diff-only prepares untracked files so patches include additions", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-diff-untracked-"))
  const reportPath = path.join(dir, "report.md")
  const diffsDir = path.join(dir, ".uxl", "diffs")
  fs.mkdirSync(diffsDir, { recursive: true })
  fs.writeFileSync(reportPath, "# report", "utf8")

  const commands = []
  let untrackedVisible = true

  try {
    const result = await runImplement(["--diff-only"], dir, {
      loadConfig: async () => ({
        paths: { root: dir, reportPath, diffsDir, reportsDir: path.join(dir, ".uxl", "reports") },
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
      resolveTarget: () => ({ workDir: dir, branchName: "uxl-diff", summary: "Target: worktree" }),
      cleanupWorktreeTarget: () => {},
      runCodexImplement: () => {},
      runCommand: (_cmd, args) => {
        commands.push(args.join(" "))
        const key = args.join(" ")
        if (key === "rev-parse --is-inside-work-tree") return { stdout: "true\n" }
        if (key === "status --porcelain") return { stdout: "" }
        if (key === "ls-files --others --exclude-standard") {
          return { stdout: untrackedVisible ? "src/new-file.js\n" : "" }
        }
        if (key === "add -N -- src/new-file.js") {
          untrackedVisible = false
          return { stdout: "" }
        }
        if (key === "diff --binary HEAD --") {
          return {
            stdout: [
              "diff --git a/src/new-file.js b/src/new-file.js",
              "new file mode 100644",
              "index 0000000..1111111",
              "--- /dev/null",
              "+++ b/src/new-file.js",
              "@@ -0,0 +1 @@",
              "+console.log('new')",
              "",
            ].join("\n"),
          }
        }
        if (key === "diff --numstat HEAD --") return { stdout: "1\t0\tsrc/new-file.js\n" }
        return { stdout: "" }
      },
    })

    assert.equal(result.diffOnly, true)
    assert.ok(commands.includes("add -N -- src/new-file.js"))
    assert.deepEqual(result.diffStats.files, ["src/new-file.js"])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("runImplement diff-only preserves runner errors when cleanup also fails", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-diff-cleanup-warning-"))
  const reportPath = path.join(dir, "report.md")
  fs.writeFileSync(reportPath, "# report", "utf8")

  const warnings = []
  const originalWarn = console.warn
  console.warn = (message) => warnings.push(String(message))

  try {
    await assert.rejects(
      () =>
        runImplement(["--diff-only"], dir, {
          loadConfig: async () => ({
            paths: { root: dir, reportPath, diffsDir: path.join(dir, ".uxl", "diffs") },
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
          resolveTarget: () => ({ workDir: dir, branchName: "uxl-diff", summary: "Target: worktree" }),
          cleanupWorktreeTarget: () => {
            throw new Error("cleanup failed")
          },
          runCodexImplement: () => {
            throw new Error("runner failed")
          },
          runCommand: (_cmd, args) => {
            const key = args.join(" ")
            if (key === "rev-parse --is-inside-work-tree") return { stdout: "true\n" }
            if (key === "rev-parse HEAD") return { stdout: "abc123\n" }
            if (key === "rev-parse --abbrev-ref HEAD") return { stdout: "main\n" }
            if (key === "status --porcelain") return { stdout: "" }
            if (key === "ls-files --others --exclude-standard") return { stdout: "" }
            return { stdout: "" }
          },
        }),
      /runner failed/
    )

    assert.ok(warnings.some((message) => message.includes("cleanup failed")))
  } finally {
    console.warn = originalWarn
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
