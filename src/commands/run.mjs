import { loadConfig } from "../config/load-config.mjs"
import { runImplement } from "./implement.mjs"
import { runReview } from "./review.mjs"
import { runShots } from "./shots.mjs"

export async function runPipeline(args = []) {
  const config = await loadConfig()

  if (config.run.runShots) {
    await runShots()
  }

  if (config.run.runReview) {
    await runReview(args)
  }

  if (config.run.runImplement) {
    await runImplement(args)
  }
}
