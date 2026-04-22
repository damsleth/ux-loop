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

function buildConfig(root) {
  const shotsDir = path.join(root, ".uxl", "shots")
  fs.mkdirSync(shotsDir, { recursive: true })
  const screenshot = path.join(shotsDir, "home-mobile.png")
  fs.writeFileSync(screenshot, "png-bytes")

  const manifestPath = path.join(shotsDir, "manifest.json")
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ groups: [{ label: "Home", files: [screenshot] }] })
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

test("runReview writes both canonical report.md and timestamped report", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-review-canonical-"))
  const config = buildConfig(root)

  await runReview([], root, {
    loadConfig: async () => config,
    reviewWithOpenAi: async () => "- issue one\n- issue two",
    createCommandLogger: silentLoggerFactory,
    loadStylePreset: noopStylePreset,
    writeJsonArtifact: () => path.join(root, ".uxl", "reports", "fake.json"),
  })

  const reportDir = path.dirname(config.paths.reportPath)
  const entries = fs.readdirSync(reportDir)
  const timestamped = entries.find((e) => /^uxl_report_\d{4}-\d{2}-\d{2}_\d+\.md$/.test(e))
  assert.ok(timestamped, `expected timestamped report in ${entries.join(", ")}`)
  assert.ok(entries.includes("report.md"), "canonical report.md must exist")

  const canonicalBody = fs.readFileSync(config.paths.reportPath, "utf8")
  const timestampedBody = fs.readFileSync(path.join(reportDir, timestamped), "utf8")
  assert.equal(canonicalBody, timestampedBody)
  assert.ok(canonicalBody.includes("issue one"))

  fs.rmSync(root, { recursive: true, force: true })
})

test("runReview overwrites stale report.md left over from a prior run", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-review-stale-"))
  const config = buildConfig(root)

  fs.mkdirSync(path.dirname(config.paths.reportPath), { recursive: true })
  fs.writeFileSync(config.paths.reportPath, "STALE REPORT FROM OLDER RUN", "utf8")

  await runReview([], root, {
    loadConfig: async () => config,
    reviewWithOpenAi: async () => "- fresh issue",
    createCommandLogger: silentLoggerFactory,
    loadStylePreset: noopStylePreset,
    writeJsonArtifact: () => path.join(root, ".uxl", "reports", "fake.json"),
  })

  const canonicalBody = fs.readFileSync(config.paths.reportPath, "utf8")
  assert.ok(!canonicalBody.includes("STALE REPORT"), "stale content must be overwritten")
  assert.ok(canonicalBody.includes("fresh issue"))

  fs.rmSync(root, { recursive: true, force: true })
})

test("runReview does not write an extra canonical pointer for custom reportPath filenames", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-review-custom-"))
  const config = buildConfig(root)
  config.paths.reportPath = path.join(root, ".uxl", "custom-report.md")

  await runReview([], root, {
    loadConfig: async () => config,
    reviewWithOpenAi: async () => "- custom issue",
    createCommandLogger: silentLoggerFactory,
    loadStylePreset: noopStylePreset,
    writeJsonArtifact: () => path.join(root, ".uxl", "reports", "fake.json"),
  })

  const reportDir = path.dirname(config.paths.reportPath)
  const entries = fs.readdirSync(reportDir)
  assert.ok(entries.includes("custom-report.md"))
  assert.ok(!entries.includes("report.md"), "canonical pointer must not be created for custom filenames")

  fs.rmSync(root, { recursive: true, force: true })
})
