import { spawnSync } from "child_process"

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "").trim()
    throw new Error(`${command} ${args.join(" ")} failed: ${details}`)
  }

  return result
}

export function assertCommandAvailable(command) {
  runCommand(command, ["--version"])
}
