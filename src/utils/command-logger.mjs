import fs from "fs"
import path from "path"

function nowIsoCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function toLines(message) {
  const text = message instanceof Error ? message.stack || message.message : String(message ?? "")
  return text.split(/\r?\n/)
}

function pad2(value) {
  return String(value).padStart(2, "0")
}

function pad3(value) {
  return String(value).padStart(3, "0")
}

function formatTerminalTime(date) {
  const centiseconds = Math.floor(date.getMilliseconds() / 10)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${pad2(centiseconds)}`
}

function formatTimezoneOffset(date) {
  const totalMinutes = -date.getTimezoneOffset()
  const sign = totalMinutes >= 0 ? "+" : "-"
  const absoluteMinutes = Math.abs(totalMinutes)
  const hours = Math.floor(absoluteMinutes / 60)
  const minutes = absoluteMinutes % 60
  return `GMT${sign}${pad2(hours)}:${pad2(minutes)}`
}

function formatFileTimestamp(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${pad3(date.getMilliseconds())} ${formatTimezoneOffset(date)}`
}

function rotateScopeLogs(logsDir, scope, maxFiles = 50) {
  const files = fs
    .readdirSync(logsDir)
    .filter((entry) => entry.startsWith(`${scope}-`) && entry.endsWith(".log"))
    .sort()

  const filesToDelete = files.slice(0, Math.max(0, files.length - maxFiles))
  for (const filename of filesToDelete) {
    fs.rmSync(path.join(logsDir, filename), { force: true })
  }
}

export function createCommandLogger({ scope, logsDir, echoToConsole = true }) {
  if (!scope || !logsDir) {
    throw new Error("createCommandLogger requires scope and logsDir.")
  }

  fs.mkdirSync(logsDir, { recursive: true })
  rotateScopeLogs(logsDir, scope, 49)
  const logPath = path.join(logsDir, `${scope}-${nowIsoCompact()}.log`)

  const write = (level, message) => {
    const lines = toLines(message)
    const fileLines = []
    for (const line of lines) {
      const now = new Date()
      fileLines.push(`[${formatFileTimestamp(now)}] [uxl:${scope}] ${line}`)
      if (echoToConsole) {
        const terminalLine = `[${formatTerminalTime(now)}] ${line}`
        if (level === "error") console.error(terminalLine)
        else if (level === "warn") console.warn(terminalLine)
        else console.log(terminalLine)
      }
    }
    fs.appendFileSync(logPath, `${fileLines.join("\n")}\n`, "utf8")
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
