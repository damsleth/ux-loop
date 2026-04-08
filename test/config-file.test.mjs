import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { loadRawConfig } from "../src/config/config-file.mjs"

test("loadRawConfig wraps import syntax errors with config path", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-config-load-"))
  const configPath = path.join(cwd, "uxl.config.mjs")

  fs.writeFileSync(configPath, "export default { invalid", "utf8")

  await assert.rejects(
    () => loadRawConfig(cwd),
    /Failed to load uxl\.config\.mjs at .*uxl\.config\.mjs/
  )

  fs.rmSync(cwd, { recursive: true, force: true })
})

test("loadRawConfig loads workspace .env values before importing config", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-config-env-"))
  const configPath = path.join(cwd, "uxl.config.mjs")
  const previous = process.env.UI_REVIEW_BASE_URL

  fs.writeFileSync(path.join(cwd, ".env"), "UI_REVIEW_BASE_URL=http://127.0.0.1:4321\n", "utf8")
  fs.writeFileSync(
    configPath,
    "export default { capture: { baseUrl: process.env.UI_REVIEW_BASE_URL } }\n",
    "utf8"
  )

  delete process.env.UI_REVIEW_BASE_URL

  try {
    const result = await loadRawConfig(cwd)
    assert.equal(result.raw.capture.baseUrl, "http://127.0.0.1:4321")
  } finally {
    if (previous === undefined) {
      delete process.env.UI_REVIEW_BASE_URL
    } else {
      process.env.UI_REVIEW_BASE_URL = previous
    }
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})
