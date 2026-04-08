import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"

import { normalizeConfig } from "../src/config/schema.mjs"

test("normalizeConfig applies defaults and resolves paths", () => {
  const config = normalizeConfig({
    paths: { root: "/tmp/example-project" },
  })

  assert.equal(config.capture.runner, "playwright")
  assert.equal(config.capture.onboarding.status, "pending")
  assert.deepEqual(config.capture.flowInventory, [])
  assert.deepEqual(config.capture.flowMapping, {})
  assert.equal(config.implement.autoCommit, false)
  assert.equal(config.review.timeoutMs, 600000)
  assert.equal(config.implement.timeoutMs, 900000)
  assert.equal(config.output.verbose, false)
  assert.equal(config.paths.shotsDir, path.resolve("/tmp/example-project", ".uxl/shots"))
  assert.equal(config.paths.reportPath, path.resolve("/tmp/example-project", ".uxl/report.md"))
})

test("normalizeConfig requires adapter in custom runner mode", () => {
  assert.throws(
    () => normalizeConfig({ capture: { runner: "custom" } }),
    /capture\.adapter is required for capture\.runner=custom/
  )
})

test("normalizeConfig validates review runner enum", () => {
  assert.throws(
    () => normalizeConfig({ review: { runner: "other" } }),
    /Invalid review\.runner/
  )
})

test("normalizeConfig accepts copilot runners", () => {
  const config = normalizeConfig({
    review: { runner: "copilot" },
    implement: { runner: "copilot" },
  })

  assert.equal(config.review.runner, "copilot")
  assert.equal(config.implement.runner, "copilot")
})

test("normalizeConfig accepts reasoning effort values", () => {
  const config = normalizeConfig({
    review: { reasoningEffort: "extraHigh" },
    implement: { reasoningEffort: "medium" },
  })

  assert.equal(config.review.reasoningEffort, "extraHigh")
  assert.equal(config.implement.reasoningEffort, "medium")
})

test("normalizeConfig accepts review.openai.imageDetail values", () => {
  const config = normalizeConfig({
    review: { openai: { imageDetail: "auto" } },
  })

  assert.equal(config.review.openai.imageDetail, "auto")
})

test("normalizeConfig validates reasoning effort enums", () => {
  assert.throws(
    () => normalizeConfig({ review: { reasoningEffort: "max" } }),
    /Invalid review\.reasoningEffort/
  )

  assert.throws(
    () => normalizeConfig({ implement: { reasoningEffort: "max" } }),
    /Invalid implement\.reasoningEffort/
  )

  assert.throws(
    () => normalizeConfig({ review: { openai: { imageDetail: "ultra" } } }),
    /Invalid review\.openai\.imageDetail/
  )
})

test("normalizeConfig validates timeout and output types", () => {
  assert.throws(
    () => normalizeConfig({ review: { timeoutMs: 0 } }),
    /Invalid review\.timeoutMs/
  )

  assert.throws(
    () => normalizeConfig({ implement: { timeoutMs: -1 } }),
    /Invalid implement\.timeoutMs/
  )

  assert.throws(
    () => normalizeConfig({ output: { verbose: "yes" } }),
    /output\.verbose must be boolean/
  )
})

test("normalizeConfig resolves capture adapter path when provided", () => {
  const config = normalizeConfig({
    paths: { root: "/tmp/workspace" },
    capture: { adapter: "./uxl.capture.mjs" },
  })

  assert.equal(config.capture.adapter, path.resolve("/tmp/workspace", "./uxl.capture.mjs"))
})

test("normalizeConfig rejects unknown mapped flow names", () => {
  assert.throws(
    () =>
      normalizeConfig({
        capture: {
          flowInventory: [{ id: "home", label: "Home", required: true }],
          flowMapping: { home: ["missing-flow"] },
          playwright: {
            flows: [{ name: "home-flow", label: "Home", path: "/" }],
          },
        },
      }),
    /unknown capture\.playwright flow name/
  )
})

test("normalizeConfig rejects complete onboarding when coverage is not full", () => {
  assert.throws(
    () =>
      normalizeConfig({
        capture: {
          onboarding: { status: "complete" },
          flowInventory: [{ id: "home", label: "Home", required: true }],
          flowMapping: {},
          playwright: { flows: [{ name: "home", label: "Home", path: "/" }] },
        },
      }),
    /cannot be "complete"/
  )
})

test("normalizeConfig accepts complete onboarding when coverage is 100%", () => {
  const config = normalizeConfig({
    capture: {
      onboarding: { status: "complete" },
      flowInventory: [{ id: "home", label: "Home", required: true }],
      flowMapping: { home: ["home"] },
      playwright: { flows: [{ name: "home", label: "Home", path: "/" }] },
    },
  })

  assert.equal(config.capture.onboarding.status, "complete")
})
