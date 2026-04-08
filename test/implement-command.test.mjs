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

test("runImplement auto-commits when enabled", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-implement-auto-commit-"))
  const reportPath = path.join(dir, "report.md")
  fs.writeFileSync(reportPath, "# report", "utf8")

  const commands = []

  try {
    await runImplement([], dir, {
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

    assert.deepEqual(commands, [
      "git status --porcelain",
      "git add -A",
      "git diff --cached --name-only",
      "git commit -m chore: apply ux loop improvements",
    ])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
