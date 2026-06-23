import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { formatGithubReport, extractReportScore, runReport } from "../src/commands/report.mjs"

const reviewReport = {
  command: "review",
  status: "success",
  steps: [
    {
      step: "review",
      issues: { critical: 1, major: 2, minor: 3 },
      score: 78,
      objective_score: 90,
      prose_score: 70,
      score_source: "blended",
    },
  ],
}

const pre36RunReport = {
  command: "run",
  status: "success",
  final_score: 64,
  steps: [{ step: "review", issues: { critical: 0, major: 1, minor: 0 }, score: 64 }],
}

const markdown = [
  "# UX review",
  "",
  "[CRITICAL] Login button has no focus state",
  "[MAJOR] Contrast on the hero text is 2.1:1",
  "Some prose that is not a finding.",
  "[MINOR] Footer links are cramped",
].join("\n")

test("formatGithubReport emits marker, score, severity table, sub-scores, and findings", () => {
  const body = formatGithubReport(reviewReport, markdown)
  assert.ok(body.startsWith("<!-- uxl-report -->"), "marker must be first for sticky-comment anchoring")
  assert.match(body, /score 78\/100/)
  assert.match(body, /🔴 critical \| 1/)
  assert.match(body, /🟠 major \| 2/)
  assert.match(body, /🟡 minor \| 3/)
  assert.match(body, /\*\*Sub-scores:\*\* objective 90 · prose 70/)
  assert.match(body, /Login button has no focus state/)
  assert.match(body, /Contrast on the hero text/)
  assert.match(body, /Footer links are cramped/)
  assert.ok(!body.includes("Some prose that is not a finding"), "non-finding prose must be excluded")
})

test("formatGithubReport tolerates a pre-plan-36 report with no sub-scores", () => {
  const body = formatGithubReport(pre36RunReport, "")
  assert.match(body, /score 64\/100/)
  assert.ok(!/Sub-scores/.test(body), "no sub-score line when objective/prose absent")
  assert.match(body, /🟠 major \| 1/)
})

test("formatGithubReport falls back to score-only when steps carry no issues", () => {
  const body = formatGithubReport({ command: "run", final_score: 88, steps: [{ step: "review" }] }, "")
  assert.match(body, /score 88\/100/)
  assert.ok(!/severity/.test(body), "no severity table when no issues present")
})

test("markdown format omits the sticky-comment marker", () => {
  const body = formatGithubReport(reviewReport, markdown, { includeMarker: false })
  assert.ok(!body.includes("<!-- uxl-report -->"))
  assert.match(body, /score 78\/100/)
})

test("formatGithubReport truncates oversized bodies under the cap with an artifacts hint", () => {
  const bigMarkdown = Array.from({ length: 5000 }, (_, i) => `[MINOR] finding number ${i} ${"x".repeat(40)}`).join("\n")
  // extractFindings caps at 10, so oversize via many findings won't trip the cap;
  // force it instead with a report carrying an enormous score-only body is not
  // possible — exercise the cap directly through a giant single finding line.
  const hugeLine = "[CRITICAL] " + "y".repeat(70000)
  const body = formatGithubReport(reviewReport, hugeLine + "\n" + bigMarkdown)
  assert.ok(body.length <= 60000, `body must be capped, got ${body.length}`)
  assert.match(body, /see workflow artifacts for the full report/)
})

test("extractReportScore reads run (final_score) and review (steps[].score) shapes", () => {
  assert.equal(extractReportScore(pre36RunReport), 64)
  assert.equal(extractReportScore(reviewReport), 78)
  assert.equal(extractReportScore({ steps: [] }), null)
})

// --- runReport --fail-under integration ---

function writeReportFixture(reportData) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-report-fixture-"))
  const reportsDir = path.join(dir, "reports")
  fs.mkdirSync(reportsDir)
  fs.writeFileSync(path.join(reportsDir, "uxl_report_2026-06-22_1.json"), JSON.stringify(reportData))
  const config = { paths: { reportsDir, reportPath: path.join(dir, "report.md") } }
  return { dir, config }
}

test("runReport --fail-under flags a below-threshold score", async () => {
  const { dir, config } = writeReportFixture(reviewReport) // score 78
  try {
    const result = await runReport(["--fail-under", "80", "--format", "github"], dir, {
      loadConfig: async () => config,
    })
    assert.equal(result.score, 78)
    assert.equal(result.belowThreshold, true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("runReport --fail-under passes when the score meets the threshold", async () => {
  const { dir, config } = writeReportFixture(reviewReport) // score 78
  try {
    const result = await runReport(["--fail-under", "78", "--format", "github"], dir, {
      loadConfig: async () => config,
    })
    assert.equal(result.belowThreshold, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("runReport rejects a non-integer --fail-under", async () => {
  await assert.rejects(
    () => runReport(["--fail-under", "8.5"], "/tmp", { loadConfig: async () => ({ paths: {} }) }),
    /Invalid --fail-under/
  )
})

test("runReport rejects an out-of-range --fail-under", async () => {
  await assert.rejects(
    () => runReport(["--fail-under", "150"], "/tmp", { loadConfig: async () => ({ paths: {} }) }),
    /Invalid --fail-under/
  )
})

test("runReport rejects an invalid --format", async () => {
  await assert.rejects(
    () => runReport(["--format", "xml"], "/tmp", { loadConfig: async () => ({ paths: {} }) }),
    /Invalid --format/
  )
})
