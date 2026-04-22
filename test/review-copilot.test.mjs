import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

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

test("reviewWithCopilot pipes prompts via stdin and keeps them out of argv", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-copilot-review-"))
  const stubPath = path.join(tmpDir, "fake-copilot.sh")
  const argsLog = path.join(tmpDir, "args.txt")
  const stdinLog = path.join(tmpDir, "stdin.txt")
  const screenshot = path.join(tmpDir, "shot.png")
  fs.writeFileSync(screenshot, "png-bytes")

  fs.writeFileSync(
    stubPath,
    `#!/bin/sh\nfor arg in "$@"; do printf '%s\\n' "$arg" >> "${argsLog}"; done\ncat > "${stdinLog}"\nprintf 'OK'\n`
  )
  fs.chmodSync(stubPath, 0o755)

  const largePrompt = `PROMPT-START --not-a-flag ${"x".repeat(200 * 1024)} PROMPT-END`
  const silentLogger = { log() {}, warn() {} }
  const result = await reviewWithCopilot({
    copilotBin: stubPath,
    model: undefined,
    prompt: largePrompt,
    label: "Sample",
    filePaths: [screenshot],
    rootDir: tmpDir,
    logger: silentLogger,
  })

  assert.equal(result, "OK")

  const argv = fs.readFileSync(argsLog, "utf8").split("\n").filter(Boolean)
  assert.ok(!argv.includes("--prompt"), "--prompt flag must not be passed")
  for (const arg of argv) {
    assert.ok(!arg.includes("PROMPT-START"), "prompt body must not appear in argv")
  }

  const stdinContent = fs.readFileSync(stdinLog, "utf8")
  assert.ok(stdinContent.startsWith(largePrompt))
  assert.ok(stdinContent.includes(screenshot))
})
