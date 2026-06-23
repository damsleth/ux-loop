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
  assert.match(logs.join("\n"), /\[uxl:implement\] skipped: upstream shots/)

  const steps = artifacts[0].steps
  assert.equal(steps.find((s) => s.step === "shots").status, "failed")
  assert.equal(steps.find((s) => s.step === "review").status, "skipped")
  assert.match(steps.find((s) => s.step === "review").skipped_reason, /shots/)
  assert.equal(steps.find((s) => s.step === "implement").status, "skipped")
  assert.match(steps.find((s) => s.step === "implement").skipped_reason, /shots/)
})

test("runPipeline skips implement after failed shots even when review is disabled", async () => {
  const order = []
  const artifacts = []

  const result = await runPipeline([], "/tmp/project", {
    loadConfig: async () =>
      createBaseConfig({ stopOnError: false, runReview: false, runShots: true, runImplement: true }),
    runShots: async () => {
      order.push("shots")
      throw new Error("shots failed")
    },
    runReview: async () => order.push("review"),
    runImplement: async () => order.push("implement"),
    errorLogger: () => {},
    writeJsonArtifact: ({ payload }) => {
      artifacts.push(payload)
      return "/tmp/report.json"
    },
  })

  assert.deepEqual(order, ["shots"])
  assert.equal(result.exitState, "partial")

  const steps = artifacts[0].steps
  const implementStep = steps.find((s) => s.step === "implement")
  assert.equal(implementStep.status, "skipped")
  assert.match(implementStep.skipped_reason, /shots/)
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

test("runPipeline runs implement alone when runShots and runReview are both disabled", async () => {
  const order = []

  const result = await runPipeline([], "/tmp/project", {
    loadConfig: async () =>
      createBaseConfig({
        stopOnError: false,
        runShots: false,
        runReview: false,
        runImplement: true,
      }),
    runShots: async () => order.push("shots"),
    runReview: async () => order.push("review"),
    runImplement: async () => order.push("implement"),
    errorLogger: () => {},
    writeJsonArtifact: () => "/tmp/report.json",
  })

  assert.deepEqual(order, ["implement"])
  assert.equal(result.exitState, "success")
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

test("runPipeline stops when blended score meets threshold", async () => {
  const artifacts = []

  const result = await runPipeline([], "/tmp/project", {
    loadConfig: async () =>
      createBaseConfig({ runShots: false, runImplement: false, scoreThreshold: 80 }),
    runShots: async () => {},
    runReview: async () => ({
      score: 82,
      scoreSource: "blended",
      objectiveScore: 90,
      proseScore: 70,
      totalIssues: 1,
      issues: { critical: 0, major: 1, minor: 0 },
    }),
    runImplement: async () => {},
    errorLogger: () => {},
    writeJsonArtifact: ({ payload }) => {
      artifacts.push(payload)
      return "/tmp/report.json"
    },
  })

  assert.equal(result.stopReason, "score threshold met (82/80)")
  assert.equal(artifacts[0].score_source, "blended")
})

test("runPipeline stop condition uses blended score from reviewResult.score", async () => {
  // score=75 does not meet threshold=80, score=85 does
  let callCount = 0

  const result = await runPipeline([], "/tmp/project", {
    loadConfig: async () =>
      createBaseConfig({ runShots: false, runImplement: true, maxIterations: 5, scoreThreshold: 80 }),
    runShots: async () => {},
    runReview: async () => {
      callCount += 1
      const score = callCount === 1 ? 75 : 85
      return {
        score,
        scoreSource: "blended",
        objectiveScore: 90,
        proseScore: score - 10,
        totalIssues: 1,
        issues: { critical: 0, major: 1, minor: 0 },
      }
    },
    runImplement: async () => {},
    errorLogger: () => {},
    writeJsonArtifact: () => "/tmp/report.json",
  })

  assert.equal(result.stopReason, "score threshold met (85/80)")
})

// --- Keep-best acceptance gate (plan 35) ---

// runReview that emits a fixed sequence of scores; runImplement that returns a
// distinct snapshot path per call so the gate can pick the right one.
function keepBestRuntime({ scores, targetMode = "current", restoreImpl, extraConfig = {} }) {
  let reviewCall = 0
  let implementCall = 0
  const restoreCalls = []
  const artifacts = []
  const runtime = {
    loadConfig: async () =>
      createBaseConfig({
        runShots: false,
        runReview: true,
        runImplement: true,
        stopOnError: false,
        maxIterations: scores.length,
        scoreThreshold: 100,
        ...extraConfig,
      }),
    runShots: async () => {},
    runReview: async () => {
      const score = scores[reviewCall]
      reviewCall += 1
      return { score, scoreSource: "blended", totalIssues: 1, issues: { critical: 0, major: 1, minor: 0 } }
    },
    runImplement: async () => {
      implementCall += 1
      return { status: "success", snapshotPath: `snap-${implementCall}`, targetMode }
    },
    restoreToSnapshot: ({ snapshotPath }) => {
      restoreCalls.push(snapshotPath)
      if (restoreImpl) restoreImpl()
    },
    errorLogger: () => {},
    writeJsonArtifact: ({ payload }) => {
      artifacts.push(payload)
      return "/tmp/report.json"
    },
  }
  return { runtime, restoreCalls, artifacts }
}

test("keep-best restores the best iteration when a later one regresses (70->80->60)", async () => {
  const { runtime, restoreCalls, artifacts } = keepBestRuntime({ scores: [70, 80, 60] })
  const result = await runPipeline([], "/tmp/project", runtime)

  // record[3].implementSnapshotPath = snapshot from implement_2 = "snap-2"
  assert.deepEqual(restoreCalls, ["snap-2"])
  assert.equal(result.keptIteration, 2)
  assert.equal(result.bestScore, 80)
  assert.equal(result.restored, true)
  assert.equal(artifacts[0].kept_iteration, 2)
  assert.equal(artifacts[0].best_score, 80)
  assert.equal(artifacts[0].restored, true)
})

test("keep-best does not restore on monotonic improvement (70->80->90)", async () => {
  const { runtime, restoreCalls, artifacts } = keepBestRuntime({ scores: [70, 80, 90] })
  const result = await runPipeline([], "/tmp/project", runtime)

  assert.deepEqual(restoreCalls, [])
  assert.equal(result.restored, false)
  assert.equal(artifacts[0].restored, false)
})

test("keep-best restores pristine state on immediate regression (80->60)", async () => {
  const { runtime, restoreCalls, artifacts } = keepBestRuntime({ scores: [80, 60] })
  await runPipeline([], "/tmp/project", runtime)

  // record[2].implementSnapshotPath = snapshot from implement_1 = "snap-1" (pristine)
  assert.deepEqual(restoreCalls, ["snap-1"])
  assert.equal(artifacts[0].kept_iteration, 1)
  assert.equal(artifacts[0].restored, true)
})

test("keep-best keeps the earlier iteration on a tie (70->70, strictly-greater)", async () => {
  const { runtime, restoreCalls, artifacts } = keepBestRuntime({ scores: [70, 70] })
  const result = await runPipeline([], "/tmp/project", runtime)

  assert.match(result.stopReason, /score did not improve \(70 -> 70\)/)
  assert.deepEqual(restoreCalls, ["snap-1"])
  assert.equal(artifacts[0].kept_iteration, 1)
})

test("keep-best is disabled by --no-keep-best", async () => {
  const { runtime, restoreCalls, artifacts } = keepBestRuntime({ scores: [70, 80, 60] })
  await runPipeline(["--no-keep-best"], "/tmp/project", runtime)

  assert.deepEqual(restoreCalls, [])
  assert.equal(artifacts[0].restored, false)
})

test("keep-best is inert when implement is disabled", async () => {
  const { runtime, restoreCalls } = keepBestRuntime({
    scores: [70, 80, 60],
    extraConfig: { runImplement: false },
  })
  await runPipeline([], "/tmp/project", runtime)

  assert.deepEqual(restoreCalls, [])
})

test("keep-best is skipped for worktree targets (iterations do not compound)", async () => {
  const { runtime, restoreCalls, artifacts } = keepBestRuntime({
    scores: [70, 80, 60],
    targetMode: "worktree",
  })
  await runPipeline([], "/tmp/project", runtime)

  assert.deepEqual(restoreCalls, [])
  assert.equal(artifacts[0].restored, "skipped")
})

test("keep-best surfaces a failed restore without masking the pipeline result", async () => {
  const logs = []
  const { runtime, artifacts } = keepBestRuntime({
    scores: [70, 80, 60],
    restoreImpl: () => { throw new Error("git reset blew up") },
  })
  runtime.errorLogger = (message) => logs.push(message)

  const result = await runPipeline([], "/tmp/project", runtime)

  assert.equal(result.restored, "failed")
  assert.equal(artifacts[0].restored, "failed")
  assert.match(logs.join("\n"), /keep-best restore failed: git reset blew up/)
  assert.match(logs.join("\n"), /uxl rollback --yes/)
})

test("runPipeline score_source in report reflects last review result", async () => {
  const artifacts = []

  await runPipeline([], "/tmp/project", {
    loadConfig: async () => createBaseConfig({ runShots: false, runImplement: false }),
    runShots: async () => {},
    runReview: async () => ({
      score: 75,
      scoreSource: "review-prose",
      objectiveScore: null,
      proseScore: 75,
      totalIssues: 1,
      issues: { critical: 0, major: 1, minor: 0 },
    }),
    runImplement: async () => {},
    errorLogger: () => {},
    writeJsonArtifact: ({ payload }) => {
      artifacts.push(payload)
      return "/tmp/report.json"
    },
  })

  assert.equal(artifacts[0].score_source, "review-prose")
})
