import test from "node:test"
import assert from "node:assert/strict"

import { assertCopilotReady, reviewWithCopilot } from "../src/runners/review-copilot.mjs"

test("assertCopilotReady throws with a clear error when the copilot binary is not found", () => {
  assert.throws(
    () => assertCopilotReady("uxl-nonexistent-copilot-binary-xyz"),
    /ENOENT|failed/
  )
})

test("reviewWithCopilot validates screenshot files before execution", async () => {
  await assert.rejects(
    () =>
      reviewWithCopilot({
        copilotBin: "copilot",
        model: undefined,
        prompt: "Review",
        label: "Sample",
        filePaths: ["/tmp/uxl-does-not-exist.png"],
        rootDir: process.cwd(),
      }),
    /Missing screenshot/
  )
})
