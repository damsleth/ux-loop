import test from "node:test"
import assert from "node:assert/strict"

import {
  OBJECTIVE_WEIGHTS,
  blendScores,
  buildObjectiveScoreSummary,
  computeObjectiveScore,
} from "../src/utils/objective-score.mjs"

// ── computeObjectiveScore ─────────────────────────────────────────────────────

test("computeObjectiveScore returns 100 for null metrics", () => {
  assert.equal(computeObjectiveScore(null), 100)
})

test("computeObjectiveScore returns 100 for undefined metrics", () => {
  assert.equal(computeObjectiveScore(undefined), 100)
})

test("computeObjectiveScore returns 100 for empty metrics object", () => {
  assert.equal(computeObjectiveScore({}), 100)
})

test("computeObjectiveScore applies axe critical weight", () => {
  const score = computeObjectiveScore({ axe: { critical: 1 } })
  assert.equal(score, 100 - OBJECTIVE_WEIGHTS.axe.critical)
})

test("computeObjectiveScore applies axe serious weight", () => {
  const score = computeObjectiveScore({ axe: { serious: 1 } })
  assert.equal(score, 100 - OBJECTIVE_WEIGHTS.axe.serious)
})

test("computeObjectiveScore applies axe moderate weight", () => {
  const score = computeObjectiveScore({ axe: { moderate: 1 } })
  assert.equal(score, 100 - OBJECTIVE_WEIGHTS.axe.moderate)
})

test("computeObjectiveScore applies axe minor weight", () => {
  const score = computeObjectiveScore({ axe: { minor: 1 } })
  assert.equal(score, 100 - OBJECTIVE_WEIGHTS.axe.minor)
})

test("computeObjectiveScore applies missingViewportMeta heuristic", () => {
  const score = computeObjectiveScore({ heuristics: { viewportMeta: false } })
  assert.equal(score, 100 - OBJECTIVE_WEIGHTS.heuristics.missingViewportMeta)
})

test("computeObjectiveScore does not penalize for viewportMeta: true", () => {
  assert.equal(computeObjectiveScore({ heuristics: { viewportMeta: true } }), 100)
})

test("computeObjectiveScore applies smallTapTargets heuristic", () => {
  const score = computeObjectiveScore({ heuristics: { smallTapTargets: 3 } })
  assert.equal(score, 100 - 3 * OBJECTIVE_WEIGHTS.heuristics.perSmallTapTarget)
})

test("computeObjectiveScore applies lowContrastSamples heuristic", () => {
  const score = computeObjectiveScore({ heuristics: { lowContrastSamples: 5 } })
  assert.equal(score, 100 - 5 * OBJECTIVE_WEIGHTS.heuristics.perLowContrastSample)
})

test("computeObjectiveScore penalizes font sizes beyond 4", () => {
  const score = computeObjectiveScore({ heuristics: { fontSizeCount: 6 } })
  assert.equal(score, 100 - 2 * OBJECTIVE_WEIGHTS.heuristics.fontSizesBeyond4)
})

test("computeObjectiveScore does not penalize fontSizeCount <= 4", () => {
  assert.equal(computeObjectiveScore({ heuristics: { fontSizeCount: 4 } }), 100)
  assert.equal(computeObjectiveScore({ heuristics: { fontSizeCount: 1 } }), 100)
})

test("computeObjectiveScore clamps to 0 for catastrophic inputs", () => {
  const score = computeObjectiveScore({
    axe: { critical: 100, serious: 100, moderate: 100, minor: 100 },
  })
  assert.equal(score, 0)
})

test("computeObjectiveScore clamps to 100 maximum", () => {
  // No penalty → should still be exactly 100
  assert.equal(computeObjectiveScore({ axe: { critical: 0 } }), 100)
})

test("computeObjectiveScore is monotonically non-increasing as violations increase", () => {
  const scores = [0, 1, 2, 3, 5].map((n) =>
    computeObjectiveScore({ axe: { critical: n } })
  )
  for (let i = 1; i < scores.length; i += 1) {
    assert.ok(scores[i] <= scores[i - 1], `score at critical=${i} must not exceed score at critical=${i - 1}`)
  }
})

test("computeObjectiveScore combined axe + heuristics fixture", () => {
  const metrics = {
    axe: { critical: 1, serious: 2, moderate: 0, minor: 3 },
    heuristics: { viewportMeta: false, smallTapTargets: 4, lowContrastSamples: 2, fontSizeCount: 6 },
  }
  const expected =
    100 -
    (1 * OBJECTIVE_WEIGHTS.axe.critical +
      2 * OBJECTIVE_WEIGHTS.axe.serious +
      3 * OBJECTIVE_WEIGHTS.axe.minor +
      OBJECTIVE_WEIGHTS.heuristics.missingViewportMeta +
      4 * OBJECTIVE_WEIGHTS.heuristics.perSmallTapTarget +
      2 * OBJECTIVE_WEIGHTS.heuristics.perLowContrastSample +
      2 * OBJECTIVE_WEIGHTS.heuristics.fontSizesBeyond4)
  assert.equal(computeObjectiveScore(metrics), Math.max(0, Math.min(100, expected)))
})

// ── buildObjectiveScoreSummary ────────────────────────────────────────────────

test("buildObjectiveScoreSummary returns null for empty groups array", () => {
  assert.equal(buildObjectiveScoreSummary([]), null)
})

test("buildObjectiveScoreSummary returns null when no group has metrics", () => {
  assert.equal(
    buildObjectiveScoreSummary([
      { label: "Home", files: ["a.png"] },
      { label: "Dashboard", files: ["b.png"] },
    ]),
    null
  )
})

test("buildObjectiveScoreSummary averages scores from groups that have metrics", () => {
  const groups = [
    { label: "A", files: ["a.png"], metrics: { axe: { critical: 0 } } },
    { label: "B", files: ["b.png"], metrics: { axe: { critical: 1 } } },
  ]
  const a = computeObjectiveScore(groups[0].metrics)
  const b = computeObjectiveScore(groups[1].metrics)
  const expected = Math.round((a + b) / 2)
  assert.equal(buildObjectiveScoreSummary(groups), expected)
})

test("buildObjectiveScoreSummary ignores groups without metrics", () => {
  const groups = [
    { label: "A", files: ["a.png"], metrics: { axe: { critical: 1 } } },
    { label: "B", files: ["b.png"] }, // no metrics
  ]
  const scoreFromA = computeObjectiveScore(groups[0].metrics)
  assert.equal(buildObjectiveScoreSummary(groups), Math.round(scoreFromA))
})

// ── blendScores ───────────────────────────────────────────────────────────────

test("blendScores uses default weights 0.6/0.4", () => {
  const result = blendScores({ objective: 80, review: 60 })
  assert.equal(result.score, Math.round(0.6 * 80 + 0.4 * 60))
  assert.equal(result.source, "blended")
})

test("blendScores rounds the blended score", () => {
  // 0.6*71 + 0.4*70 = 42.6 + 28 = 70.6 → rounds to 71
  const result = blendScores({ objective: 71, review: 70 })
  assert.equal(result.score, Math.round(0.6 * 71 + 0.4 * 70))
})

test("blendScores respects weight overrides", () => {
  const result = blendScores({ objective: 100, review: 0, weights: { objective: 0.3, review: 0.7 } })
  assert.equal(result.score, Math.round(0.3 * 100 + 0.7 * 0))
  assert.equal(result.source, "blended")
})

test("blendScores source is review-prose when only review is present", () => {
  const result = blendScores({ objective: null, review: 72 })
  assert.equal(result.score, 72)
  assert.equal(result.source, "review-prose")
})

test("blendScores source is objective when only objective is present", () => {
  const result = blendScores({ objective: 88, review: null })
  assert.equal(result.score, 88)
  assert.equal(result.source, "objective")
})

test("blendScores source is review-prose when both are absent", () => {
  const result = blendScores({ objective: null, review: null })
  assert.equal(result.score, 100)
  assert.equal(result.source, "review-prose")
})

test("blendScores source is review-prose when called with no arguments", () => {
  const result = blendScores()
  assert.equal(result.source, "review-prose")
})

test("blendScores source is review-prose when objective is undefined", () => {
  const result = blendScores({ review: 55 })
  assert.equal(result.score, 55)
  assert.equal(result.source, "review-prose")
})

test("blendScores clamps at 100 max", () => {
  const result = blendScores({ objective: 100, review: 100 })
  assert.equal(result.score, 100)
})

test("blendScores clamps at 0 min", () => {
  // Cannot actually go below 0 with valid inputs, but test rounding
  const result = blendScores({ objective: 0, review: 0 })
  assert.equal(result.score, 0)
})
