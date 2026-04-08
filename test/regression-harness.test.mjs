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

test("runPipeline returns partial when a non-critical step fails with stopOnError false", async () => {
  const result = await runPipeline([], "/tmp/project", {
    loadConfig: async () => ({
      run: {
        runShots: true,
        runReview: true,
        runImplement: true,
        stopOnError: false,
        maxIterations: 1,
        scoreThreshold: 90,
      },
      implement: { scope: null },
      paths: { reportsDir: "/tmp/project/.uxl/reports" },
    }),
    runShots: async () => { throw new Error("shots failed") },
    runReview: async () => ({ status: "success", score: 72, totalIssues: 3, issues: null }),
    runImplement: async () => ({ status: "success", diffStats: { filesChanged: 1, linesAdded: 2, linesRemoved: 0 } }),
    errorLogger: () => {},
    writeJsonArtifact: ({ payload }) => {
      assert.equal(payload.status, "partial")
      return "/tmp/project/.uxl/reports/report.json"
    },
  })

  assert.equal(result.exitState, "partial")
})

test("runPipeline logs step errors through errorLogger when stopOnError is false", async () => {
  const logged = []

  await runPipeline([], "/tmp/project", {
    loadConfig: async () => ({
      run: {
        runShots: false,
        runReview: true,
        runImplement: false,
        stopOnError: false,
        maxIterations: 1,
        scoreThreshold: 90,
      },
      implement: { scope: null },
      paths: { reportsDir: "/tmp/project/.uxl/reports" },
    }),
    runShots: async () => {},
    runReview: async () => { throw new Error("review exploded") },
    runImplement: async () => {},
    errorLogger: (msg) => logged.push(msg),
    writeJsonArtifact: () => "/tmp/project/.uxl/reports/report.json",
  })

  assert.ok(logged.some((entry) => String(entry).includes("review exploded")), "errorLogger must receive the step error message")
})
