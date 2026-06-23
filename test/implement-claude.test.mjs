import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { runClaudeImplement } from "../src/runners/implement-claude.mjs"

test("runClaudeImplement throws with a clear error when the claude binary is not found", () => {
  assert.throws(
    () =>
      runClaudeImplement({
        claudeBin: "uxl-nonexistent-claude-binary-xyz",
        model: undefined,
        workDir: process.cwd(),
        prompt: "test prompt",
      }),
    /ENOENT|failed/
  )
})

test("runClaudeImplement runs in workDir, pipes prompt via stdin, and excludes Bash", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-claude-impl-"))
  const stubPath = path.join(tmpDir, "fake-claude.sh")
  const argsLog = path.join(tmpDir, "args.txt")
  const stdinLog = path.join(tmpDir, "stdin.txt")
  const pwdLog = path.join(tmpDir, "pwd.txt")

  fs.writeFileSync(
    stubPath,
    `#!/bin/sh\npwd > "${pwdLog}"\nfor arg in "$@"; do printf '%s\\n' "$arg" >> "${argsLog}"; done\ncat > "${stdinLog}"\n`
  )
  fs.chmodSync(stubPath, 0o755)

  const largePrompt = `PROMPT-START --not-a-flag ${"x".repeat(200 * 1024)} PROMPT-END`
  runClaudeImplement({
    claudeBin: stubPath,
    model: "claude-opus-4-8",
    workDir: tmpDir,
    prompt: largePrompt,
  })

  const argv = fs.readFileSync(argsLog, "utf8").split("\n").filter(Boolean)
  assert.ok(argv.includes("-p"), "print-mode flag must be passed")
  assert.ok(argv.includes("--permission-mode"), "--permission-mode must be passed")
  assert.ok(argv.includes("acceptEdits"), "acceptEdits permission mode must be used")
  assert.ok(argv.includes("--allowedTools"), "--allowedTools must be passed")
  assert.ok(argv.includes("--strict-mcp-config"), "MCP servers must be disabled")
  assert.ok(argv.includes("--model"), "--model must be passed when set")
  assert.ok(argv.includes("claude-opus-4-8"), "model value must be passed")
  assert.ok(!argv.includes(largePrompt), "prompt body must not appear in argv")

  const allowed = argv[argv.indexOf("--allowedTools") + 1]
  assert.ok(!/\bBash\b/.test(allowed), `Bash must be excluded from allowed tools, got: ${allowed}`)
  assert.ok(allowed.includes("Edit") && allowed.includes("Write"), "Edit/Write must be allowed")

  // realpath guard: macOS tmpdir is a symlink, so compare resolved paths
  assert.equal(fs.realpathSync(fs.readFileSync(pwdLog, "utf8").trim()), fs.realpathSync(tmpDir))

  const stdinContent = fs.readFileSync(stdinLog, "utf8")
  assert.equal(stdinContent, largePrompt)

  fs.rmSync(tmpDir, { recursive: true, force: true })
})
