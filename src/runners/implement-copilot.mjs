import { runCommand } from "../utils/process.mjs"

export function runCopilotImplement({ copilotBin, model, timeoutMs, workDir, prompt }) {
  const args = [
    "--allow-all-tools",
    "--no-color",
    "--stream",
    "off",
    "--log-level",
    "error",
    "--add-dir",
    workDir,
  ]

  if (model) {
    args.push("--model", model)
  }

  return runCommand(copilotBin, args, {
    input: prompt,
    stdio: ["pipe", "inherit", "inherit"],
    maxBuffer: 10 * 1024 * 1024,
    cwd: workDir,
    timeoutMs,
  })
}
