import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { resolveReportInputPath } from "../src/commands/implement.mjs"

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
