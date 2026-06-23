import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { assertClaudeReady, reviewWithClaude } from "../src/runners/review-claude.mjs"

test("assertClaudeReady throws with a clear error when the claude binary is not found", () => {
  assert.throws(
    () => assertClaudeReady("uxl-nonexistent-claude-binary-xyz"),
    /ENOENT|failed/
  )
})

test("reviewWithClaude validates screenshot files before execution", async () => {
  await assert.rejects(
    () =>
      reviewWithClaude({
        claudeBin: "claude",
        model: undefined,
        prompt: "Review",
        label: "Sample",
        filePaths: ["/tmp/uxl-does-not-exist.png"],
        rootDir: process.cwd(),
      }),
    /Missing screenshot/
  )
})

test("reviewWithClaude pipes prompt via stdin and passes -p/--allowedTools/--model in argv", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-claude-review-"))
  const stubPath = path.join(tmpDir, "fake-claude.sh")
  const argsLog = path.join(tmpDir, "args.txt")
  const stdinLog = path.join(tmpDir, "stdin.txt")
  const screenshot = path.join(tmpDir, "shot.png")
  fs.writeFileSync(screenshot, "png-bytes")

  fs.writeFileSync(
    stubPath,
    `#!/bin/sh\nfor arg in "$@"; do printf '%s\\n' "$arg" >> "${argsLog}"; done\ncat > "${stdinLog}"\nprintf '[MINOR] looks fine'\n`
  )
  fs.chmodSync(stubPath, 0o755)

  const largePrompt = `PROMPT-START --not-a-flag ${"x".repeat(200 * 1024)} PROMPT-END`
  const silentLogger = { log() {}, warn() {} }
  const result = await reviewWithClaude({
    claudeBin: stubPath,
    model: "claude-opus-4-8",
    prompt: largePrompt,
    label: "Home",
    filePaths: [screenshot],
    rootDir: tmpDir,
    logger: silentLogger,
  })

  assert.equal(result, "[MINOR] looks fine")

  const argv = fs.readFileSync(argsLog, "utf8").split("\n").filter(Boolean)
  assert.ok(argv.includes("-p"), "print-mode flag must be passed")
  assert.ok(argv.includes("--allowedTools"), "--allowedTools must be passed")
  assert.ok(argv.includes("Read"), "review must restrict tools to Read")
  assert.ok(argv.includes("--strict-mcp-config"), "MCP servers must be disabled")
  assert.ok(argv.includes("--model"), "--model must be passed when set")
  assert.ok(argv.includes("claude-opus-4-8"), "model value must be passed")
  for (const arg of argv) {
    assert.ok(!arg.includes("PROMPT-START"), "prompt body must not appear in argv")
  }

  const stdinContent = fs.readFileSync(stdinLog, "utf8")
  assert.ok(stdinContent.startsWith(largePrompt), "prompt must arrive via stdin")
  assert.ok(stdinContent.includes(screenshot), "stdin prompt must include screenshot path")
  assert.ok(stdinContent.includes("Home"), "stdin prompt must include the group label")

  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test("reviewWithClaude throws when the CLI produces no output", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-claude-empty-"))
  const stubPath = path.join(tmpDir, "fake-claude.sh")
  const screenshot = path.join(tmpDir, "shot.png")
  fs.writeFileSync(screenshot, "png-bytes")
  fs.writeFileSync(stubPath, `#!/bin/sh\ncat > /dev/null\n`)
  fs.chmodSync(stubPath, 0o755)

  await assert.rejects(
    () =>
      reviewWithClaude({
        claudeBin: stubPath,
        prompt: "Review",
        label: "Empty",
        filePaths: [screenshot],
        rootDir: tmpDir,
        logger: { log() {}, warn() {} },
      }),
    /did not contain text output/
  )

  fs.rmSync(tmpDir, { recursive: true, force: true })
})
