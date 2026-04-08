import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import path from "path"

import { computeReviewScore, extractSeverityCounts } from "../src/utils/review-score.mjs"

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
