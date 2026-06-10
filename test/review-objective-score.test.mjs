import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { runReview } from "../src/commands/review.mjs"

function silentLoggerFactory() {
  return { log() {}, warn() {}, error() {} }
}

function noopStylePreset() {
  return null
}

function buildConfig(root, extraManifestGroups = []) {
  const shotsDir = path.join(root, ".uxl", "shots")
  fs.mkdirSync(shotsDir, { recursive: true })
  const screenshot = path.join(shotsDir, "home-mobile.png")
  fs.writeFileSync(screenshot, "png-bytes")

  const groups = [{ label: "Home", files: [screenshot] }, ...extraManifestGroups]
  const manifestPath = path.join(shotsDir, "manifest.json")
  fs.writeFileSync(manifestPath, JSON.stringify({ groups }))

  return {
    paths: {
      root,
      manifestPath,
      reportPath: path.join(root, ".uxl", "report.md"),
      logsDir: path.join(root, ".uxl", "logs"),
      reportsDir: path.join(root, ".uxl", "reports"),
    },
    output: { verbose: false },
    limits: { maxReviewGroups: 5 },
    style: null,
    run: {},
    review: {
      runner: "openai",
      model: "gpt-4o",
      timeoutMs: 10000,
      codex: { bin: "codex" },
      copilot: { bin: "copilot" },
      openai: { apiKeyEnv: "UXL_TEST_KEY_NOT_USED", imageDetail: "high" },
    },
  }
}

function buildConfigWithMetrics(root) {
  const shotsDir = path.join(root, ".uxl", "shots")
  fs.mkdirSync(shotsDir, { recursive: true })
  const screenshot = path.join(shotsDir, "home-mobile.png")
  fs.writeFileSync(screenshot, "png-bytes")

  const metrics = {
    axe: { critical: 0, serious: 2, moderate: 1, minor: 0 },
    heuristics: { viewportMeta: true, smallTapTargets: 3, lowContrastSamples: 1, fontSizeCount: 3 },
  }

  const manifestPath = path.join(shotsDir, "manifest.json")
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ groups: [{ label: "Home", files: [screenshot], metrics }] })
  )

  return {
    paths: {
      root,
      manifestPath,
      reportPath: path.join(root, ".uxl", "report.md"),
      logsDir: path.join(root, ".uxl", "logs"),
      reportsDir: path.join(root, ".uxl", "reports"),
    },
    output: { verbose: false },
    limits: { maxReviewGroups: 5 },
    style: null,
    run: {},
    review: {
      runner: "openai",
      model: "gpt-4o",
      timeoutMs: 10000,
      codex: { bin: "codex" },
      copilot: { bin: "copilot" },
      openai: { apiKeyEnv: "UXL_TEST_KEY_NOT_USED", imageDetail: "high" },
    },
  }
}

// ── no-metrics path: identical to today ──────────────────────────────────────

test("runReview without manifest metrics returns score_source=review-prose", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-review-no-metrics-"))
  const config = buildConfig(root)
  const captured = []

  const result = await runReview([], root, {
    loadConfig: async () => config,
    reviewWithOpenAi: async () => "[CRITICAL] bad contrast\n[MAJOR] small tap targets",
    createCommandLogger: silentLoggerFactory,
    loadStylePreset: noopStylePreset,
    writeJsonArtifact: ({ payload }) => {
      captured.push(payload)
      return path.join(root, ".uxl", "reports", "fake.json")
    },
  })

  assert.equal(result.scoreSource, "review-prose")
  assert.equal(result.objectiveScore, null)
  assert.ok(typeof result.proseScore === "number")
  assert.equal(result.score, result.proseScore, "score must equal prose score when no objective metrics")

  const step = captured[0]?.steps?.[0]
  assert.equal(step?.score_source, "review-prose")
  assert.equal(step?.objective_score, null)
  assert.equal(step?.prose_score, result.proseScore)
  assert.equal(step?.scoreSource, "review-prose")

  fs.rmSync(root, { recursive: true, force: true })
})

test("runReview without manifest metrics produces identical score to prose-only path", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-review-prose-compat-"))
  const config = buildConfig(root)

  const critique = "[CRITICAL] bad contrast\n[MAJOR] small tap targets\n[MINOR] spacing"
  const result = await runReview([], root, {
    loadConfig: async () => config,
    reviewWithOpenAi: async () => critique,
    createCommandLogger: silentLoggerFactory,
    loadStylePreset: noopStylePreset,
    writeJsonArtifact: () => path.join(root, ".uxl", "reports", "fake.json"),
  })

  // score must be the prose score (no blending without metrics)
  assert.equal(result.score, result.proseScore)
  assert.equal(result.scoreSource, "review-prose")

  fs.rmSync(root, { recursive: true, force: true })
})

// ── with-metrics path: blended score ─────────────────────────────────────────

test("runReview with manifest metrics returns score_source=blended", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-review-with-metrics-"))
  const config = buildConfigWithMetrics(root)
  const captured = []

  const result = await runReview([], root, {
    loadConfig: async () => config,
    reviewWithOpenAi: async () => "[MAJOR] spacing issues",
    createCommandLogger: silentLoggerFactory,
    loadStylePreset: noopStylePreset,
    writeJsonArtifact: ({ payload }) => {
      captured.push(payload)
      return path.join(root, ".uxl", "reports", "fake.json")
    },
  })

  assert.equal(result.scoreSource, "blended")
  assert.ok(result.objectiveScore !== null, "objectiveScore must be a number when metrics are present")
  assert.ok(typeof result.proseScore === "number")
  assert.ok(typeof result.score === "number")

  // blended = round(0.6 * objective + 0.4 * prose)
  const expectedBlended = Math.round(0.6 * result.objectiveScore + 0.4 * result.proseScore)
  assert.equal(result.score, expectedBlended)

  const step = captured[0]?.steps?.[0]
  assert.equal(step?.score_source, "blended")
  assert.ok(step?.objective_score !== null)
  assert.equal(step?.prose_score, result.proseScore)
  assert.equal(step?.objectiveScore, result.objectiveScore)
  assert.equal(step?.proseScore, result.proseScore)
  assert.equal(step?.scoreSource, "blended")

  fs.rmSync(root, { recursive: true, force: true })
})

test("runReview with metrics respects custom scoreWeights from config", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-review-weights-"))
  const config = buildConfigWithMetrics(root)
  config.run = { scoreWeights: { objective: 0.8, review: 0.2 } }

  const result = await runReview([], root, {
    loadConfig: async () => config,
    reviewWithOpenAi: async () => "[MAJOR] issue",
    createCommandLogger: silentLoggerFactory,
    loadStylePreset: noopStylePreset,
    writeJsonArtifact: () => path.join(root, ".uxl", "reports", "fake.json"),
  })

  const expectedBlended = Math.round(0.8 * result.objectiveScore + 0.2 * result.proseScore)
  assert.equal(result.score, expectedBlended)

  fs.rmSync(root, { recursive: true, force: true })
})

test("runReview with metrics includes blended score in report header", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-review-header-"))
  const config = buildConfigWithMetrics(root)

  await runReview([], root, {
    loadConfig: async () => config,
    reviewWithOpenAi: async () => "[MAJOR] issue",
    createCommandLogger: silentLoggerFactory,
    loadStylePreset: noopStylePreset,
    writeJsonArtifact: () => path.join(root, ".uxl", "reports", "fake.json"),
  })

  const report = fs.readFileSync(config.paths.reportPath, "utf8")
  assert.match(report, /Review score: \d+\/100 \(blended: objective \d+, prose \d+\)/)

  fs.rmSync(root, { recursive: true, force: true })
})

test("runReview without metrics includes prose-only score header (no blended keyword)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-review-prose-header-"))
  const config = buildConfig(root)

  await runReview([], root, {
    loadConfig: async () => config,
    reviewWithOpenAi: async () => "[MAJOR] issue",
    createCommandLogger: silentLoggerFactory,
    loadStylePreset: noopStylePreset,
    writeJsonArtifact: () => path.join(root, ".uxl", "reports", "fake.json"),
  })

  const report = fs.readFileSync(config.paths.reportPath, "utf8")
  assert.match(report, /Review score: \d+\/100 \(\d+ critical/)
  assert.ok(!report.includes("blended"), "report must not mention blended when no metrics")

  fs.rmSync(root, { recursive: true, force: true })
})
