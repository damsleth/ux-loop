import test from "node:test"
import assert from "node:assert/strict"

import { countIssuesInCritique } from "../src/commands/review.mjs"

test("countIssuesInCritique counts bullet and numbered list items", () => {
  assert.equal(countIssuesInCritique("- one\n- two\n3. three"), 3)
})

test("countIssuesInCritique returns zero for no issues marker", () => {
  assert.equal(countIssuesInCritique("No issues found."), 0)
})

test("countIssuesInCritique returns zero for unstructured non-empty text", () => {
  assert.equal(countIssuesInCritique("General commentary with no explicit issue bullets."), 0)
})
