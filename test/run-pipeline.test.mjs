import test from "node:test"
import assert from "node:assert/strict"

import { runPipeline } from "../src/commands/run.mjs"

function createBaseConfig(overrides = {}) {
  return {
    run: {
      runShots: true,
      runReview: true,
      runImplement: true,
      stopOnError: true,
      ...overrides,
    },
  }
}

test("runPipeline executes steps in shots->review->implement order", async () => {
  const order = []

  await runPipeline(["--model", "x"], "/tmp/project", {
    loadConfig: async () => createBaseConfig(),
    runShots: async () => order.push("shots"),
    runReview: async () => order.push("review"),
    runImplement: async () => order.push("implement"),
    errorLogger: () => {},
  })

  assert.deepEqual(order, ["shots", "review", "implement"])
})

test("runPipeline stops immediately on error when stopOnError=true", async () => {
  const order = []

  await assert.rejects(
    () =>
      runPipeline([], "/tmp/project", {
        loadConfig: async () => createBaseConfig({ stopOnError: true }),
        runShots: async () => {
          order.push("shots")
        },
        runReview: async () => {
          order.push("review")
          throw new Error("review failed")
        },
        runImplement: async () => {
          order.push("implement")
        },
        errorLogger: () => {},
      }),
    /review failed/
  )

  assert.deepEqual(order, ["shots", "review"])
})

test("runPipeline skips downstream stages when shots fails with stopOnError=false", async () => {
  const order = []
  const logs = []
  const artifacts = []

  const result = await runPipeline([], "/tmp/project", {
    loadConfig: async () => createBaseConfig({ stopOnError: false }),
    runShots: async () => {
      order.push("shots")
      throw new Error("shots failed")
    },
    runReview: async () => {
      order.push("review")
    },
    runImplement: async () => {
      order.push("implement")
    },
    errorLogger: (message) => logs.push(message),
    writeJsonArtifact: ({ payload }) => {
      artifacts.push(payload)
      return "/tmp/report.json"
    },
  })

  assert.deepEqual(order, ["shots"])
  assert.equal(result.exitState, "partial")
  assert.match(logs.join("\n"), /\[uxl:shots\] shots failed/)
  assert.match(logs.join("\n"), /\[uxl:review\] skipped: upstream shots/)
  assert.match(logs.join("\n"), /\[uxl:implement\] skipped: upstream review/)

  const steps = artifacts[0].steps
  assert.equal(steps.find((s) => s.step === "shots").status, "failed")
  assert.equal(steps.find((s) => s.step === "review").status, "skipped")
  assert.match(steps.find((s) => s.step === "review").skipped_reason, /shots/)
  assert.equal(steps.find((s) => s.step === "implement").status, "skipped")
  assert.match(steps.find((s) => s.step === "implement").skipped_reason, /review/)
})

test("runPipeline skips implement when review fails with stopOnError=false", async () => {
  const order = []

  const result = await runPipeline([], "/tmp/project", {
    loadConfig: async () => createBaseConfig({ stopOnError: false }),
    runShots: async () => order.push("shots"),
    runReview: async () => {
      order.push("review")
      throw new Error("review failed")
    },
    runImplement: async () => order.push("implement"),
    errorLogger: () => {},
    writeJsonArtifact: () => "/tmp/report.json",
  })

  assert.deepEqual(order, ["shots", "review"])
  assert.equal(result.exitState, "partial")
})

test("runPipeline splits shared flags by command", async () => {
  let seenReviewArgs = null
  let seenImplementArgs = null

  await runPipeline(["--runner", "openai", "--target", "branch"], "/tmp/project", {
    loadConfig: async () => createBaseConfig(),
    runShots: async () => {},
    runReview: async (args) => {
      seenReviewArgs = args
    },
    runImplement: async (args) => {
      seenImplementArgs = args
    },
    errorLogger: () => {},
  })

  assert.deepEqual(seenReviewArgs, ["--runner", "openai"])
  assert.deepEqual(seenImplementArgs, ["--target", "branch"])
})
