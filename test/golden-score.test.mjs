import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import path from "path"

import { computeReviewScore, extractSeverityCounts } from "../src/utils/review-score.mjs"
import { blendScores, buildObjectiveScoreSummary, computeObjectiveScore } from "../src/utils/objective-score.mjs"

const FIXTURES = [
  path.resolve("test/golden/landing-page"),
  path.resolve("test/golden/dashboard"),
]

for (const fixtureDir of FIXTURES) {
  test(`golden scoring fixture: ${path.basename(fixtureDir)}`, () => {
    const critique = fs.readFileSync(path.join(fixtureDir, "critique.md"), "utf8")
    const expected = JSON.parse(fs.readFileSync(path.join(fixtureDir, "expected.json"), "utf8"))

    const counts = extractSeverityCounts(critique)
    assert.equal(counts.critical, expected.critical)
    assert.equal(counts.major, expected.major)
    assert.equal(counts.minor, expected.minor)
    assert.equal(computeReviewScore(counts), expected.score)
  })
}

// ── blended golden case ───────────────────────────────────────────────────────

test("golden blended score: landing-page critique + known metrics fixture", () => {
  const critique = fs.readFileSync(path.resolve("test/golden/landing-page/critique.md"), "utf8")
  const expected = JSON.parse(fs.readFileSync(path.resolve("test/golden/landing-page/expected.json"), "utf8"))

  // prose score from the golden fixture
  const counts = extractSeverityCounts(critique)
  const proseScore = computeReviewScore(counts)
  assert.equal(proseScore, expected.score, "prose score must match golden")

  // synthetic metrics fixture
  const groups = [
    {
      label: "Landing Page",
      files: ["home-desktop.png"],
      metrics: {
        axe: { critical: 0, serious: 1, moderate: 0, minor: 2 },
        heuristics: { viewportMeta: true, smallTapTargets: 2, lowContrastSamples: 0, fontSizeCount: 3 },
      },
    },
  ]

  const objectiveScore = buildObjectiveScoreSummary(groups)
  assert.ok(objectiveScore !== null, "objective score must not be null when metrics are present")

  const blended = blendScores({ objective: objectiveScore, review: proseScore })
  assert.equal(blended.source, "blended")
  assert.equal(blended.score, Math.round(0.6 * objectiveScore + 0.4 * proseScore))

  // sanity: blended score is between the two components
  const lo = Math.min(objectiveScore, proseScore)
  const hi = Math.max(objectiveScore, proseScore)
  assert.ok(blended.score >= lo && blended.score <= hi,
    `blended ${blended.score} must be between ${lo} and ${hi}`)
})
