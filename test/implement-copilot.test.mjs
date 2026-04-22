import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

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

test("runCopilotImplement pipes prompts via stdin and keeps them out of argv", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-copilot-impl-"))
  const stubPath = path.join(tmpDir, "fake-copilot.sh")
  const argsLog = path.join(tmpDir, "args.txt")
  const stdinLog = path.join(tmpDir, "stdin.txt")

  fs.writeFileSync(
    stubPath,
    `#!/bin/sh\nfor arg in "$@"; do printf '%s\\n' "$arg" >> "${argsLog}"; done\ncat > "${stdinLog}"\n`
  )
  fs.chmodSync(stubPath, 0o755)

  const largePrompt = `PROMPT-START --not-a-flag ${"x".repeat(200 * 1024)} PROMPT-END`
  runCopilotImplement({
    copilotBin: stubPath,
    model: "gpt-4o",
    workDir: tmpDir,
    prompt: largePrompt,
  })

  const argv = fs.readFileSync(argsLog, "utf8").split("\n").filter(Boolean)
  assert.ok(!argv.includes(largePrompt), "prompt body must not appear in argv")
  assert.ok(!argv.includes("--prompt"), "--prompt flag must not be passed")
  assert.ok(argv.includes("--add-dir"))
  assert.ok(argv.includes(tmpDir))
  assert.ok(argv.includes("--model"))
  assert.ok(argv.includes("gpt-4o"))

  const stdinContent = fs.readFileSync(stdinLog, "utf8")
  assert.equal(stdinContent, largePrompt)
})
