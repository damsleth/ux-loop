import test from "node:test"
import assert from "node:assert/strict"

import { runCodexImplement } from "../src/runners/implement-codex.mjs"

test("runCodexImplement throws with a clear error when the codex binary is not found", () => {
  assert.throws(
    () =>
      runCodexImplement({
        codexBin: "uxl-nonexistent-binary-xyz",
        model: undefined,
        workDir: process.cwd(),
        prompt: "test prompt",
      }),
    /ENOENT|failed/
  )
})
