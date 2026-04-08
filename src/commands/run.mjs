import { loadConfig } from "../config/load-config.mjs"
import { IMPLEMENT_OPTION_NAMES, runImplement } from "./implement.mjs"
import { REVIEW_OPTION_NAMES, runReview } from "./review.mjs"
import { runShots } from "./shots.mjs"

function splitPipelineArgs(args) {
  const reviewArgs = []
  const implementArgs = []
  const known = new Set([...REVIEW_OPTION_NAMES, ...IMPLEMENT_OPTION_NAMES])

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`)
    }

    if (token.includes("=")) {
      const [key] = token.slice(2).split("=")
      if (!known.has(key)) {
        throw new Error(`Unknown flag: --${key}`)
      }
      if (REVIEW_OPTION_NAMES.has(key)) reviewArgs.push(token)
      if (IMPLEMENT_OPTION_NAMES.has(key)) implementArgs.push(token)
      continue
    }

    const key = token.slice(2)
    if (!known.has(key)) {
      throw new Error(`Unknown flag: --${key}`)
    }

    const next = args[i + 1]
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`)
    }

    if (REVIEW_OPTION_NAMES.has(key)) reviewArgs.push(token, next)
    if (IMPLEMENT_OPTION_NAMES.has(key)) implementArgs.push(token, next)
    i += 1
  }

  return { reviewArgs, implementArgs }
}

export async function runPipeline(args = [], cwd = process.cwd(), runtime = {}) {
  const load = runtime.loadConfig || loadConfig
  const runShotsStep = runtime.runShots || runShots
  const runReviewStep = runtime.runReview || runReview
  const runImplementStep = runtime.runImplement || runImplement
  const errorLogger = runtime.errorLogger || console.error
  const config = await load(cwd)
  const { reviewArgs, implementArgs } = splitPipelineArgs(args)

  const runStep = async (label, fn) => {
    try {
      await fn()
    } catch (err) {
      if (config.run.stopOnError) throw err
      errorLogger(`[uxl:${label}] ${err instanceof Error ? err.message : err}`)
    }
  }

  if (config.run.runShots) await runStep("shots", () => runShotsStep([], cwd))
  if (config.run.runReview) await runStep("review", () => runReviewStep(reviewArgs, cwd))
  if (config.run.runImplement) await runStep("implement", () => runImplementStep(implementArgs, cwd))
}
