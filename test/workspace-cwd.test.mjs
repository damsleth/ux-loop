import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import os from "os"
import path from "path"

import { resolveWorkspaceCwd } from "../src/utils/workspace-cwd.mjs"

test("resolveWorkspaceCwd prefers INIT_CWD when present", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-workspace-"))
  const packageDir = path.join(projectDir, "node_modules", "@damsleth", "ux-loop")
  fs.mkdirSync(packageDir, { recursive: true })

  const resolved = resolveWorkspaceCwd({
    cwd: packageDir,
    env: {
      INIT_CWD: projectDir,
    },
  })

  assert.equal(resolved, path.resolve(projectDir))
})

test("resolveWorkspaceCwd honors explicit UXL_CWD", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-workspace-explicit-"))
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-workspace-other-"))

  const resolved = resolveWorkspaceCwd({
    cwd: otherDir,
    env: {
      UXL_CWD: projectDir,
      INIT_CWD: otherDir,
    },
  })

  assert.equal(resolved, path.resolve(projectDir))
})

test("resolveWorkspaceCwd falls back to process cwd", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-workspace-fallback-"))
  const resolved = resolveWorkspaceCwd({ cwd, env: {} })
  assert.equal(resolved, path.resolve(cwd))
})
