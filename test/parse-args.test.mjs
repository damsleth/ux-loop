import test from "node:test"
import assert from "node:assert/strict"

import { parseReviewArgs } from "../src/commands/review.mjs"
import { parseImplementArgs } from "../src/commands/implement.mjs"

// --- parseReviewArgs ---

test("parseReviewArgs returns empty object for no args", () => {
  assert.deepEqual(parseReviewArgs([]), {})
})

test("parseReviewArgs parses --runner= inline form", () => {
  assert.equal(parseReviewArgs(["--runner=openai"]).runner, "openai")
})

test("parseReviewArgs parses --runner space-separated form", () => {
  assert.equal(parseReviewArgs(["--runner", "openai"]).runner, "openai")
})

test("parseReviewArgs parses --model= inline form", () => {
  assert.equal(parseReviewArgs(["--model=gpt-4o"]).model, "gpt-4o")
})

test("parseReviewArgs parses --model space-separated form", () => {
  assert.equal(parseReviewArgs(["--model", "gpt-4o"]).model, "gpt-4o")
})

test("parseReviewArgs parses --runner and --model together", () => {
  const result = parseReviewArgs(["--runner=openai", "--model=gpt-4o"])
  assert.equal(result.runner, "openai")
  assert.equal(result.model, "gpt-4o")
})

test("parseReviewArgs parses --reasoning-effort inline form", () => {
  assert.equal(parseReviewArgs(["--reasoning-effort=high"]).reasoningEffort, "high")
})

test("parseReviewArgs parses --reasoning-effort space-separated form", () => {
  assert.equal(parseReviewArgs(["--reasoning-effort", "medium"]).reasoningEffort, "medium")
})

test("parseReviewArgs parses --image-detail flags", () => {
  assert.equal(parseReviewArgs(["--image-detail=auto"]).imageDetail, "auto")
  assert.equal(parseReviewArgs(["--image-detail", "low"]).imageDetail, "low")
})

test("parseReviewArgs rejects unknown flags and missing values", () => {
  assert.throws(() => parseReviewArgs(["--nope"]), /Unknown flag/)
  assert.throws(() => parseReviewArgs(["--runner"]), /Missing value/)
})

// --- parseImplementArgs ---

test("parseImplementArgs returns empty object for no args", () => {
  assert.deepEqual(parseImplementArgs([]), {})
})

test("parseImplementArgs parses --target= inline form", () => {
  assert.equal(parseImplementArgs(["--target=branch"]).target, "branch")
})

test("parseImplementArgs parses --target space-separated form", () => {
  assert.equal(parseImplementArgs(["--target", "current"]).target, "current")
})

test("parseImplementArgs parses --branch", () => {
  assert.equal(parseImplementArgs(["--branch=my-feat"]).branch, "my-feat")
})

test("parseImplementArgs parses --worktree", () => {
  assert.equal(parseImplementArgs(["--worktree=/tmp/wt"]).worktree, "/tmp/wt")
})

test("parseImplementArgs parses --model", () => {
  assert.equal(parseImplementArgs(["--model", "o3"]).model, "o3")
})

test("parseImplementArgs parses --reasoning-effort", () => {
  assert.equal(parseImplementArgs(["--reasoning-effort", "low"]).reasoningEffort, "low")
})

test("parseImplementArgs parses all flags together", () => {
  const result = parseImplementArgs([
    "--target=worktree",
    "--branch",
    "uxl-feat",
    "--model=o3",
    "--reasoning-effort=extraHigh",
  ])
  assert.equal(result.target, "worktree")
  assert.equal(result.branch, "uxl-feat")
  assert.equal(result.model, "o3")
  assert.equal(result.reasoningEffort, "extraHigh")
})

test("parseImplementArgs rejects unknown flags and missing values", () => {
  assert.throws(() => parseImplementArgs(["--bogus"]), /Unknown flag/)
  assert.throws(() => parseImplementArgs(["--target"]), /Missing value/)
})
