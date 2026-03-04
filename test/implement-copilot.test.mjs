import test from "node:test"
import assert from "node:assert/strict"

import { runCopilotImplement } from "../src/runners/implement-copilot.mjs"

test("runCopilotImplement throws with a clear error when the copilot binary is not found", () => {
  assert.throws(
    () =>
      runCopilotImplement({
        copilotBin: "uxl-nonexistent-copilot-binary-xyz",
        model: undefined,
        workDir: process.cwd(),
        prompt: "test prompt",
      }),
    /ENOENT|failed/
  )
})
