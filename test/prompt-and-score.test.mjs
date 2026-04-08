import test from "node:test"
import assert from "node:assert/strict"

import { buildDefaultImplementPrompt } from "../src/prompts/default-implement-prompt.mjs"
import { buildDefaultReviewPrompt } from "../src/prompts/default-review-prompt.mjs"
import { computeReviewScore, extractSeverityCounts } from "../src/utils/review-score.mjs"
import { validateScopeAgainstFiles } from "../src/commands/implement.mjs"

test("buildDefaultReviewPrompt requests severity markers", () => {
  const prompt = buildDefaultReviewPrompt()
  assert.match(prompt, /\[CRITICAL\]/)
  assert.match(prompt, /Start every issue bullet with exactly one severity marker/)
})

test("buildDefaultImplementPrompt injects ordered constraints and scope guidance", () => {
  const prompt = buildDefaultImplementPrompt("# Review", { scope: "css-only", autoCommit: false })
  assert.match(prompt, /1\. Read the report and identify the top 5 highest-severity issues\./)
  assert.match(prompt, /Only modify CSS, SCSS, Sass, Less, or style blocks/)
})

test("extractSeverityCounts and computeReviewScore parse structured critiques deterministically", () => {
  const critique = [
    "[CRITICAL] Primary CTA is unreadable against the background.",
    "[MAJOR] Section spacing collapses on tablet.",
    "[MINOR] Icon labels could be clearer.",
  ].join("\n")

  const counts = extractSeverityCounts(critique)
  assert.deepEqual(counts, { critical: 1, major: 1, minor: 1 })
  assert.equal(computeReviewScore(counts), 67)
})

test("validateScopeAgainstFiles rejects logic files for layout-safe and non-style files for css-only", () => {
  assert.deepEqual(validateScopeAgainstFiles(["src/app.tsx"], "layout-safe").violations, [
    "Scope violation (layout-safe): src/app.tsx",
  ])
  assert.deepEqual(validateScopeAgainstFiles(["src/app.tsx"], "css-only").violations, [
    "Scope violation (css-only): src/app.tsx",
  ])
})
