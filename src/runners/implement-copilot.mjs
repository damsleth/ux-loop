import { runCommand } from "../utils/process.mjs"

export function runCopilotImplement({ copilotBin, model, workDir, prompt }) {
  const args = [
    "--allow-all-tools",
    "--no-color",
    "--stream",
    "off",
    "--log-level",
    "error",
    "--add-dir",
    workDir,
    "--prompt",
    prompt,
  ]

  if (model) {
    args.push("--model", model)
  }

  runCommand(copilotBin, args, {
    stdio: ["pipe", "inherit", "inherit"],
    maxBuffer: 10 * 1024 * 1024,
    cwd: workDir,
  })
}
