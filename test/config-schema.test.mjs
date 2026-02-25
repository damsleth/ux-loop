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
