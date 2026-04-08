import { runImplement } from "./implement.mjs"

export async function runDiff(args = [], cwd = process.cwd(), runtime = {}) {
  return runImplement([...args, "--diff-only"], cwd, runtime)
}
