import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"

import { normalizeConfig } from "../src/config/schema.mjs"

test("normalizeConfig applies defaults and resolves paths", () => {
  const config = normalizeConfig({
    paths: { root: "/tmp/example-project" },
  })

  assert.equal(config.capture.runner, "playwright")
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
