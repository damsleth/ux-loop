import { spawn, spawnSync } from "child_process"

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

export function runCommandAsync(command, args, options = {}) {
  const { input, maxBuffer = 10 * 1024 * 1024, ...spawnOptions } = options

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...spawnOptions,
      stdio: spawnOptions.stdio || ["pipe", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let totalBytes = 0
    let settled = false

    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    const appendOutput = (key, chunk) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8")
      totalBytes += Buffer.byteLength(text)
      if (totalBytes > maxBuffer) {
        try {
          child.kill("SIGKILL")
        } catch {
          // ignore
        }
        fail(new Error(`${command} ${args.join(" ")} failed: output exceeded maxBuffer (${maxBuffer} bytes)`))
        return
      }
      if (key === "stdout") stdout += text
      else stderr += text
    }

    if (child.stdout) child.stdout.on("data", (chunk) => appendOutput("stdout", chunk))
    if (child.stderr) child.stderr.on("data", (chunk) => appendOutput("stderr", chunk))

    child.on("error", (error) => fail(error))
    child.on("close", (status) => {
      if (settled) return
      if (status !== 0) {
        const details = (stderr || stdout || "").trim()
        fail(new Error(`${command} ${args.join(" ")} failed: ${details}`))
        return
      }
      settled = true
      resolve({
        status,
        stdout,
        stderr,
      })
    })

    if (child.stdin) {
      if (input !== undefined) child.stdin.end(input)
      else child.stdin.end()
    }
  })
}

export function assertCommandAvailable(command) {
  runCommand(command, ["--version"])
}
