import test from "node:test"
import assert from "node:assert/strict"

import {
  assertFullFlowCoverage,
  evaluateFlowCoverage,
} from "../src/capture/flow-onboarding.mjs"

test("evaluateFlowCoverage reports complete coverage at 100%", () => {
  const report = evaluateFlowCoverage({
    flowInventory: [{ id: "home", label: "Home", required: true }],
    flowMapping: { home: ["home"] },
    playwrightFlows: [{ name: "home" }],
  })

  assert.equal(report.complete, true)
  assert.equal(report.coveragePercent, 100)
})

test("evaluateFlowCoverage reports unmapped required entries", () => {
  const report = evaluateFlowCoverage({
    flowInventory: [{ id: "home", label: "Home", required: true }],
    flowMapping: {},
    playwrightFlows: [{ name: "home" }],
  })

  assert.equal(report.complete, false)
  assert.deepEqual(report.unmappedRequiredIds, ["home"])
})

test("assertFullFlowCoverage throws actionable error for incomplete coverage", () => {
  assert.throws(
    () =>
      assertFullFlowCoverage({
        capture: {
          runner: "playwright",
          flowInventory: [{ id: "home", label: "Home", required: true }],
          flowMapping: {},
          playwright: { flows: [{ name: "home", label: "Home", path: "/" }] },
        },
      }),
    /uxl flows check/
  )
})

test("assertFullFlowCoverage accepts complete mappings", () => {
  const report = assertFullFlowCoverage({
    capture: {
      runner: "playwright",
      flowInventory: [{ id: "home", label: "Home", required: true }],
      flowMapping: { home: ["home"] },
      playwright: { flows: [{ name: "home", label: "Home", path: "/" }] },
    },
  })

  assert.equal(report.complete, true)
})
