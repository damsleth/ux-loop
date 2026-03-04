import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import os from "os"
import path from "path"

import { createCommandLogger } from "../src/utils/command-logger.mjs"

test("createCommandLogger writes scoped logs to file", () => {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-logger-"))
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
})
