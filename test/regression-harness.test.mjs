import test from "node:test"
import assert from "node:assert/strict"

import { runPipeline } from "../src/commands/run.mjs"

test("runPipeline regression harness emits a structured report shape with score data", async () => {
  let capturedReport = null

  const result = await runPipeline(["--iterations", "2"], "/tmp/project", {
    loadConfig: async () => ({
      run: {
        runShots: true,
        runReview: true,
        runImplement: true,
        stopOnError: true,
        maxIterations: 2,
        scoreThreshold: 95,
      },
      implement: {
        scope: "layout-safe",
      },
      paths: {
        reportsDir: "/tmp/project/.uxl/reports",
      },
    }),
    runShots: async () => ({ status: "success", screenshots: 1 }),
    runReview: async () => ({
      status: "success",
      score: 96,
      totalIssues: 1,
      issues: { critical: 0, major: 0, minor: 1 },
    }),
    runImplement: async () => ({ status: "success", diffStats: { filesChanged: 1, linesAdded: 5, linesRemoved: 1 } }),
    errorLogger: () => {},
    writeJsonArtifact: ({ payload }) => {
      capturedReport = payload
      return "/tmp/project/.uxl/reports/uxl_report_test.json"
    },
  })

  assert.equal(result.exitState, "success")
  assert.equal(capturedReport.command, "run")
  assert.equal(capturedReport.status, "success")
  assert.equal(capturedReport.final_score, 96)
  assert.equal(Array.isArray(capturedReport.steps), true)
  assert.equal(capturedReport.steps[0].step, "shots")
  assert.equal(capturedReport.steps[1].step, "review")
})
