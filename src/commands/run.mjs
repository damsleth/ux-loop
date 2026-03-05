import { loadConfig } from "../config/load-config.mjs"
import { runImplement } from "./implement.mjs"
import { runReview } from "./review.mjs"
import { runShots } from "./shots.mjs"

export async function runPipeline(args = [], cwd = process.cwd(), runtime = {}) {
  const load = runtime.loadConfig || loadConfig
  const runShotsStep = runtime.runShots || runShots
  const runReviewStep = runtime.runReview || runReview
  const runImplementStep = runtime.runImplement || runImplement
  const errorLogger = runtime.errorLogger || console.error
  const config = await load(cwd)

  const runStep = async (label, fn) => {
    try {
      await fn()
    } catch (err) {
      if (config.run.stopOnError) throw err
      errorLogger(`[uxl:${label}] ${err instanceof Error ? err.message : err}`)
    }
  }

  if (config.run.runShots) await runStep("shots", () => runShotsStep(cwd))
  if (config.run.runReview) await runStep("review", () => runReviewStep(args, cwd))
  if (config.run.runImplement) await runStep("implement", () => runImplementStep(args, cwd))
}
