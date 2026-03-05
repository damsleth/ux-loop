import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import os from "os"
import path from "path"

import { createCommandLogger } from "../src/utils/command-logger.mjs"

test("createCommandLogger writes scoped logs to file", () => {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-logger-"))
    const terminalLines = []
    const originalLog = console.log
    const originalWarn = console.warn
    const originalError = console.error
    console.log = (message) => terminalLines.push(String(message))
    console.warn = (message) => terminalLines.push(String(message))
    console.error = (message) => terminalLines.push(String(message))

    try {
      const logger = createCommandLogger({ scope: "review", logsDir })

  logger.log("hello")
  logger.warn("warn-line")
  logger.error("error-line")

  const files = fs.readdirSync(logsDir).filter((entry) => entry.startsWith("review-") && entry.endsWith(".log"))
  assert.equal(files.length, 1)

  const content = fs.readFileSync(path.join(logsDir, files[0]), "utf8")
  assert.match(content, /\[uxl:review\] Logging to /)
  assert.match(content, /\[uxl:review\] hello/)
  assert.match(content, /\[uxl:review\] warn-line/)
  assert.match(content, /\[uxl:review\] error-line/)
      assert.equal(terminalLines.length, 4)
      for (const line of terminalLines) {
        assert.match(line, /^\[\d{2}:\d{2}:\d{2}\.\d{2}\] /)
        assert.doesNotMatch(line, /\[uxl:review\]/)
      }
    } finally {
      console.log = originalLog
      console.warn = originalWarn
      console.error = originalError
    }
})

test("createCommandLogger rotates old scoped log files", () => {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-logger-rotate-"))

  for (let i = 0; i < 55; i += 1) {
    const suffix = String(i).padStart(2, "0")
    const name = `review-2026-01-01T00-00-00-${suffix}.log`
    fs.writeFileSync(path.join(logsDir, name), "old\n", "utf8")
  }

  createCommandLogger({ scope: "review", logsDir })

  const remaining = fs
    .readdirSync(logsDir)
    .filter((entry) => entry.startsWith("review-") && entry.endsWith(".log"))

  assert.ok(remaining.length <= 50)
})
