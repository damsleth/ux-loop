import { loadConfig } from "../config/load-config.mjs"
import { IMPLEMENT_OPTION_NAMES, runImplement } from "./implement.mjs"
import { REVIEW_OPTION_NAMES, runReview } from "./review.mjs"
import { SHOTS_OPTION_NAMES, runShots } from "./shots.mjs"
import { writeJsonArtifact } from "../utils/artifacts.mjs"
import path from "path"

const RUN_VALUE_OPTIONS = new Set(["iterations", "score-threshold"])
const RUN_BOOLEAN_OPTIONS = new Set()

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
  const known = new Set([...SHOTS_OPTION_NAMES, ...REVIEW_OPTION_NAMES, ...IMPLEMENT_OPTION_NAMES, ...RUN_VALUE_OPTIONS])

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`)
    }

    const key = token.includes("=") ? token.slice(2).split("=")[0] : token.slice(2)
    if (!known.has(key)) {
      throw new Error(`Unknown flag: --${key}`)
    }

    const isBoolean =
      SHOTS_OPTION_NAMES.has(key) || REVIEW_OPTION_NAMES.has(key) || IMPLEMENT_OPTION_NAMES.has(key)
        ? !RUN_VALUE_OPTIONS.has(key) && !token.includes("=") && !args[i + 1]?.startsWith("--") && false
        : false
    const expectsValue = RUN_VALUE_OPTIONS.has(key) || ["runner", "model", "reasoning-effort", "image-detail", "target", "branch", "worktree", "scope", "prompt-file", "style"].includes(key)

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
    if (isBoolean) continue
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
  const config = await load(cwd)
  const { shotsArgs, reviewArgs, implementArgs, runOptions } = splitPipelineArgs(args)
  const iterations = normalizeIterations(runOptions.iterations, config.run.maxIterations || 1)
  const scoreThreshold = normalizeScoreThreshold(runOptions["score-threshold"], config.run.scoreThreshold || 90)

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

  try {
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      iterationsRun = iteration
      if (config.run.runShots) {
        await runStep(iteration, "shots", () => runShotsStep(shotsArgs, cwd))
      }

      let reviewResult = null
      if (config.run.runReview) {
        const outcome = await runStep(iteration, "review", () => runReviewStep(reviewArgs, cwd))
        if (outcome.status === "success") {
          reviewResult = outcome.result
          finalScore = reviewResult?.score ?? finalScore
          if (initialScore === null && reviewResult?.score !== undefined) {
            initialScore = reviewResult.score
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
        await runStep(iteration, "implement", () => runImplementStep(implementArgs, cwd))
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
      stop_reason: stopReason,
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
    stopReason,
    reportJsonPath,
  }
}
