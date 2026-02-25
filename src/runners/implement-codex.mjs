import { runCommand } from "../utils/process.mjs"

export function runCodexImplement({ codexBin, model, workDir, prompt }) {
  const args = [
    "exec",
    "--full-auto",
    "--color",
    "never",
    "--sandbox",
    "workspace-write",
    "-C",
    workDir,
  ]

  if (model) {
    args.push("--model", model)
  }

  args.push("-")

  runCommand(codexBin, args, {
    input: prompt,
    stdio: ["pipe", "inherit", "inherit"],
    maxBuffer: 10 * 1024 * 1024,
  })
}
