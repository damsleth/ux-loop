import fs from "fs"
import path from "path"

function nowIsoCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function toLines(message) {
  const text = message instanceof Error ? message.stack || message.message : String(message ?? "")
  return text.split(/\r?\n/)
}

export function createCommandLogger({ scope, logsDir }) {
  if (!scope || !logsDir) {
    throw new Error("createCommandLogger requires scope and logsDir.")
  }

  fs.mkdirSync(logsDir, { recursive: true })
  const logPath = path.join(logsDir, `${scope}-${nowIsoCompact()}.log`)

  const write = (level, message) => {
    const lines = toLines(message)
    for (const line of lines) {
      const prefixed = `[${new Date().toISOString()}] [uxl:${scope}] ${line}`
      fs.appendFileSync(logPath, `${prefixed}\n`, "utf8")
      if (level === "error") console.error(prefixed)
      else if (level === "warn") console.warn(prefixed)
      else console.log(prefixed)
    }
  }

  write("log", `Logging to ${logPath}`)

  return {
    logPath,
    log(message) {
      write("log", message)
    },
    warn(message) {
      write("warn", message)
    },
    error(message) {
      write("error", message)
    },
  }
}
