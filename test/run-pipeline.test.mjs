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

test("runPipeline logs and continues when stopOnError=false", async () => {
  const order = []
  const logs = []

  await runPipeline([], "/tmp/project", {
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
  })

  assert.deepEqual(order, ["shots", "review", "implement"])
  assert.equal(logs.length, 1)
  assert.match(logs[0], /\[uxl:shots\] shots failed/)
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
