import { loadConfig } from "../config/load-config.mjs"
import { IMPLEMENT_OPTION_NAMES, IMPLEMENT_VALUE_OPTIONS, runImplement } from "./implement.mjs"
import { REVIEW_OPTION_NAMES, REVIEW_VALUE_OPTIONS, runReview } from "./review.mjs"
import { SHOTS_OPTION_NAMES, runShots } from "./shots.mjs"
import { writeJsonArtifact } from "../utils/artifacts.mjs"
import { restoreToSnapshot } from "../git/restore.mjs"
import path from "path"

const RUN_VALUE_OPTIONS = new Set(["iterations", "score-threshold"])
const RUN_BOOLEAN_OPTIONS = new Set(["no-keep-best"])

function readFlagValue(args, index, key) {
  const token = args[index]
  if (token.includes("=")) {
    return token.slice(token.indexOf("=") + 1)
  }
  const next = args[index + 1]
  if (!next || next.startsWith("--")) {
    throw new Error(`Missing value for --${key}`)
  }
  return next
}

function splitPipelineArgs(args) {
  const shotsArgs = []
  const reviewArgs = []
  const implementArgs = []
  const runOptions = {}
  const known = new Set([
    ...SHOTS_OPTION_NAMES,
    ...REVIEW_OPTION_NAMES,
    ...IMPLEMENT_OPTION_NAMES,
    ...RUN_VALUE_OPTIONS,
    ...RUN_BOOLEAN_OPTIONS,
  ])

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`)
    }

    const key = token.includes("=") ? token.slice(2).split("=")[0] : token.slice(2)
    if (!known.has(key)) {
      throw new Error(`Unknown flag: --${key}`)
    }

    const expectsValue = RUN_VALUE_OPTIONS.has(key) || REVIEW_VALUE_OPTIONS.has(key) || IMPLEMENT_VALUE_OPTIONS.has(key)

    if (RUN_VALUE_OPTIONS.has(key)) {
      const value = readFlagValue(args, i, key)
      runOptions[key] = value
      if (!token.includes("=")) i += 1
      continue
    }

    if (expectsValue) {
      const value = readFlagValue(args, i, key)
      if (REVIEW_OPTION_NAMES.has(key)) reviewArgs.push(`--${key}`, value)
      if (IMPLEMENT_OPTION_NAMES.has(key)) implementArgs.push(`--${key}`, value)
      if (!token.includes("=")) i += 1
      continue
    }

    if (SHOTS_OPTION_NAMES.has(key)) shotsArgs.push(`--${key}`)
    if (REVIEW_OPTION_NAMES.has(key)) reviewArgs.push(`--${key}`)
    if (IMPLEMENT_OPTION_NAMES.has(key)) implementArgs.push(`--${key}`)
    if (RUN_BOOLEAN_OPTIONS.has(key)) runOptions[key] = true
  }

  return { shotsArgs, reviewArgs, implementArgs, runOptions }
}

function normalizeIterations(value, fallback) {
  const resolved = value === undefined ? fallback : Number.parseInt(value, 10)
  if (!Number.isInteger(resolved) || resolved <= 0 || resolved > 10) {
    throw new Error("Invalid --iterations: expected an integer between 1 and 10.")
  }
  return resolved
}

function normalizeScoreThreshold(value, fallback) {
  const resolved = value === undefined ? fallback : Number.parseInt(value, 10)
  if (!Number.isInteger(resolved) || resolved <= 0 || resolved > 100) {
    throw new Error("Invalid --score-threshold: expected an integer between 1 and 100.")
  }
  return resolved
}

export async function runPipeline(args = [], cwd = process.cwd(), runtime = {}) {
  const startedAt = Date.now()
  const load = runtime.loadConfig || loadConfig
  const runShotsStep = runtime.runShots || runShots
  const runReviewStep = runtime.runReview || runReview
  const runImplementStep = runtime.runImplement || runImplement
  const errorLogger = runtime.errorLogger || console.error
  const writeArtifact = runtime.writeJsonArtifact || writeJsonArtifact
  const restore = runtime.restoreToSnapshot || restoreToSnapshot
  const config = await load(cwd)
  const { shotsArgs, reviewArgs, implementArgs, runOptions } = splitPipelineArgs(args)
  const iterations = normalizeIterations(runOptions.iterations, config.run.maxIterations || 1)
  const scoreThreshold = normalizeScoreThreshold(runOptions["score-threshold"], config.run.scoreThreshold || 90)
  const keepBest = config.run.keepBest !== false && !runOptions["no-keep-best"]

  // Keep-best gate state. A review at iteration k scores the UI produced by
  // implement_(k-1); the snapshot implement_(k-1) wrote captures the *pre*-impl
  // state, so to keep the best iteration B we restore record[B+1]'s snapshot
  // (the snapshot implement_B wrote = the exact UI that review_B scored).
  const iterationResults = []
  let bestIteration = { iteration: null, score: -Infinity }
  let pendingImplement = null // { snapshotPath, targetMode } from the previous iteration's implement
  let anyImplementSucceeded = false

  const stepReports = []
  let iterationsRun = 0
  let previousScore = null
  let initialScore = null
  let finalScore = null
  let stopReason = null
  let sawFailure = false
  let haltedByFailure = false
  let fatalError = null

  const runStep = async (iteration, label, fn) => {
    const stepStartedAt = Date.now()
    try {
      const result = await fn()
      stepReports.push({
        iteration,
        step: label,
        status: "success",
        duration_ms: Date.now() - stepStartedAt,
        result: result || null,
      })
      return { status: "success", result }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      stepReports.push({
        iteration,
        step: label,
        status: "failed",
        duration_ms: Date.now() - stepStartedAt,
        error: message,
      })
      sawFailure = true
      if (config.run.stopOnError) {
        haltedByFailure = true
        throw err
      }
      errorLogger(`[uxl:${label}] ${message}`)
      return { status: "failed", error: message }
    }
  }

  const recordSkipped = (iteration, label, reason) => {
    stepReports.push({
      iteration,
      step: label,
      status: "skipped",
      duration_ms: 0,
      skipped_reason: reason,
    })
    sawFailure = true
    errorLogger(`[uxl:${label}] skipped: ${reason}`)
    return { status: "skipped", reason }
  }

  try {
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      iterationsRun = iteration
      let shotsOutcome = { status: "skipped", reason: "disabled in config" }
      if (config.run.runShots) {
        shotsOutcome = await runStep(iteration, "shots", () => runShotsStep(shotsArgs, cwd))
      }

      let reviewOutcome = { status: "skipped", reason: "disabled in config" }
      let reviewResult = null
      if (config.run.runReview) {
        if (config.run.runShots && shotsOutcome.status !== "success") {
          reviewOutcome = recordSkipped(iteration, "review", "upstream shots step did not succeed")
        } else {
          reviewOutcome = await runStep(iteration, "review", () => runReviewStep(reviewArgs, cwd))
          if (reviewOutcome.status === "success") {
            reviewResult = reviewOutcome.result
            finalScore = reviewResult?.score ?? finalScore
            if (initialScore === null && reviewResult?.score !== undefined) {
              initialScore = reviewResult.score
            }
            if (reviewResult?.score !== undefined && reviewResult?.score !== null) {
              iterationResults.push({
                iteration,
                score: reviewResult.score,
                implementSnapshotPath: pendingImplement?.snapshotPath ?? null,
                targetMode: pendingImplement?.targetMode ?? null,
              })
              if (reviewResult.score > bestIteration.score) {
                bestIteration = { iteration, score: reviewResult.score }
              }
            }
          }
        }
      }

      if (reviewResult && (reviewResult.score !== undefined || reviewResult.totalIssues !== undefined)) {
        const score = reviewResult.score
        if ((reviewResult.totalIssues || 0) === 0) {
          stopReason = "review found zero issues"
          break
        }
        if (score >= scoreThreshold) {
          stopReason = `score threshold met (${score}/${scoreThreshold})`
          break
        }
        if (previousScore !== null && score <= previousScore) {
          stopReason = `score did not improve (${previousScore} -> ${score})`
          break
        }
        previousScore = score
      }

      if (config.run.runImplement) {
        if (config.run.runShots && shotsOutcome.status !== "success") {
          recordSkipped(iteration, "implement", "upstream shots step did not succeed")
        } else if (config.run.runReview && reviewOutcome.status !== "success") {
          recordSkipped(iteration, "implement", "upstream review step did not succeed")
        } else {
          const implementOutcome = await runStep(iteration, "implement", () => runImplementStep(implementArgs, cwd))
          if (implementOutcome.status === "success" && implementOutcome.result?.snapshotPath) {
            pendingImplement = {
              snapshotPath: implementOutcome.result.snapshotPath,
              targetMode: implementOutcome.result.targetMode ?? null,
            }
            anyImplementSucceeded = true
          }
        }
      }
    }
  } catch (error) {
    fatalError = error
    errorLogger(error instanceof Error ? error.message : error)
  }

  if (!stopReason && iterationsRun >= iterations) {
    stopReason = `reached max iterations (${iterations})`
  }

  const exitState = haltedByFailure ? "failed" : sawFailure ? "partial" : "success"
  const summary = initialScore !== null || finalScore !== null
    ? `initial score ${initialScore ?? "n/a"} -> final score ${finalScore ?? "n/a"}`
    : "no review score available"

  console.log(`Pipeline completed: ${exitState} (${summary})`)
  console.log(`Iterations run: ${iterationsRun}. Stop reason: ${stopReason}.`)

  // Keep-best acceptance gate: if a later iteration regressed below an earlier
  // one, restore the working tree to the best iteration's state. Inert for
  // review-only runs, single-iteration runs, or when no implement produced a
  // snapshot. worktree targets don't compound iterations, so the gate is a no-op.
  const keptIteration = bestIteration.iteration
  const bestScore = bestIteration.score === -Infinity ? null : bestIteration.score
  let restored = false
  const lastReviewed = iterationResults.length ? iterationResults[iterationResults.length - 1].iteration : null
  const gateEligible = keepBest && config.run.runImplement && iterationsRun >= 2 && anyImplementSucceeded

  if (gateEligible && keptIteration !== null && lastReviewed !== null && keptIteration < lastReviewed) {
    const restoreRecord = iterationResults.find((entry) => entry.iteration === keptIteration + 1)
    if (restoreRecord && restoreRecord.implementSnapshotPath) {
      if (restoreRecord.targetMode === "worktree") {
        console.log("keep-best: skipped (worktree target does not compound iterations)")
        restored = "skipped"
      } else {
        try {
          restore({ snapshotPath: restoreRecord.implementSnapshotPath, runtime })
          restored = true
          console.log(`Best iteration kept: #${keptIteration} (score ${bestScore}). Restored working tree from snapshot ${restoreRecord.implementSnapshotPath}.`)
        } catch (err) {
          restored = "failed"
          const message = err instanceof Error ? err.message : String(err)
          errorLogger(`keep-best restore failed: ${message}`)
          errorLogger("Restore manually with: uxl rollback --yes --to <timestamp>")
        }
      }
    }
  } else if (gateEligible && keptIteration !== null && lastReviewed !== null && keptIteration >= lastReviewed) {
    console.log("Final iteration was the best — nothing to restore.")
  }

  const reportJsonPath = writeArtifact({
    dir: config.paths?.reportsDir || path.join(cwd, ".uxl", "reports"),
    prefix: "uxl_report",
    payload: {
      timestamp: new Date().toISOString(),
      command: "run",
      status: exitState,
      duration_ms: Date.now() - startedAt,
      model: config.review?.model || config.implement?.model || null,
      scope: config.implement?.scope || null,
      iteration: iterationsRun,
      initial_score: initialScore,
      final_score: finalScore,
      kept_iteration: keptIteration,
      best_score: bestScore,
      restored,
      stop_reason: stopReason,
      score_source: stepReports.reduce((last, entry) => entry.result?.scoreSource ?? last, null),
      steps: stepReports.map((entry) => ({
        step: entry.step,
        iteration: entry.iteration,
        status: entry.status,
        duration_ms: entry.duration_ms,
        score: entry.result?.score ?? null,
        issues: entry.result?.issues ?? null,
        screenshots: entry.result?.screenshots ?? null,
        files_changed: entry.result?.diffStats?.filesChanged ?? null,
        lines_added: entry.result?.diffStats?.linesAdded ?? null,
        lines_removed: entry.result?.diffStats?.linesRemoved ?? null,
        error: entry.error || null,
        skipped_reason: entry.skipped_reason || null,
      })),
    },
  })

  if (fatalError) {
    throw fatalError
  }

  return {
    exitState,
    iterationsRun,
    initialScore,
    finalScore,
    keptIteration,
    bestScore,
    restored,
    stopReason,
    reportJsonPath,
  }
}
