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
