import test from "node:test"
import assert from "node:assert/strict"

import { runCommandAsync } from "../src/utils/process.mjs"

test("runCommandAsync captures stdout", async () => {
  const result = await runCommandAsync(process.execPath, ["-e", "process.stdout.write('ok')"])
  assert.equal(result.stdout, "ok")
})

test("runCommandAsync rejects on non-zero exit", async () => {
  await assert.rejects(
    () => runCommandAsync(process.execPath, ["-e", "process.stderr.write('boom'); process.exit(2)"]),
    /failed: boom/
  )
})

test("runCommandAsync rejects on timeout", async () => {
  await assert.rejects(
    () => runCommandAsync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], { timeoutMs: 10 }),
    /timed out after 10ms/
  )
})
