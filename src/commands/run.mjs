import { loadConfig } from "../config/load-config.mjs"
import { runImplement } from "./implement.mjs"
import { runReview } from "./review.mjs"
import { runShots } from "./shots.mjs"

export async function runPipeline(args = [], cwd = process.cwd()) {
  const config = await loadConfig(cwd)

  const runStep = async (label, fn) => {
    try {
      await fn()
    } catch (err) {
      if (config.run.stopOnError) throw err
      console.error(`[uxl:${label}] ${err instanceof Error ? err.message : err}`)
    }
  }

  if (config.run.runShots) await runStep("shots", () => runShots(cwd))
  if (config.run.runReview) await runStep("review", () => runReview(args, cwd))
  if (config.run.runImplement) await runStep("implement", () => runImplement(args, cwd))
}
