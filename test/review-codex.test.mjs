import fs from "fs"
import os from "os"
import path from "path"
import test from "node:test"
import assert from "node:assert/strict"

import { assertCodexReady, reviewWithCodex } from "../src/runners/review-codex.mjs"

test("assertCodexReady throws with a clear error when the codex binary is not found", () => {
  assert.throws(
    () => assertCodexReady("uxl-nonexistent-binary-xyz"),
    /ENOENT|failed/
  )
})

test("reviewWithCodex rejects missing screenshots with a clear error", async () => {
  await assert.rejects(
    () =>
      reviewWithCodex({
        codexBin: "codex",
        model: undefined,
        prompt: "Review",
        label: "Sample",
        filePaths: ["/tmp/uxl-does-not-exist.png"],
      }),
    /Missing screenshot/
  )
})

test("reviewWithCodex accepts a screenshot path containing a comma", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-test-"))
  const commaPath = path.join(tmpDir, "screen,shot.png")
  fs.writeFileSync(commaPath, Buffer.alloc(8))

  try {
    await assert.rejects(
      () =>
        reviewWithCodex({
          codexBin: "uxl-nonexistent-binary-xyz",
          model: undefined,
          prompt: "Review",
          label: "Comma path test",
          filePaths: [commaPath],
        }),
      /ENOENT|failed|spawn/i
    )
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test("reviewWithCodex builds separate --image args per file", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-test-"))
  const fileA = path.join(tmpDir, "a.png")
  const fileB = path.join(tmpDir, "b,c.png")
  fs.writeFileSync(fileA, Buffer.alloc(8))
  fs.writeFileSync(fileB, Buffer.alloc(8))

  const logged = []
  const fakeLogger = { log: (msg) => logged.push(msg) }

  try {
    await assert.rejects(
      () =>
        reviewWithCodex({
          codexBin: "uxl-nonexistent-binary-xyz",
          model: undefined,
          prompt: "Review",
          label: "Multi file test",
          filePaths: [fileA, fileB],
          logger: fakeLogger,
        }),
      /ENOENT|failed|spawn/i
    )
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }

  const cmdLog = logged.find((m) => m.startsWith("Codex command:"))
  assert.ok(cmdLog, "expected a Codex command log line")

  // Two separate --image flags means no CSV encoding was used
  const occurrences = (cmdLog.match(/--image/g) || []).length
  assert.equal(occurrences, 2, `expected two separate --image flags (one per file), got: ${cmdLog}`)
})
