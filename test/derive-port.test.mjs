import test from "node:test"
import assert from "node:assert/strict"

import { derivePortFromCwd } from "../src/utils/derive-port.mjs"

test("derivePortFromCwd is deterministic for the same basename", () => {
  assert.equal(derivePortFromCwd("/tmp/my-app"), derivePortFromCwd("/tmp/my-app"))
  assert.equal(
    derivePortFromCwd("/var/projects/my-app"),
    derivePortFromCwd("/home/user/code/my-app")
  )
})

test("derivePortFromCwd stays within the default 40000-49999 range", () => {
  const samples = [
    "/tmp/a",
    "/tmp/long-project-name-that-is-somewhat-weird",
    "/tmp/123",
    "/tmp/",
    "",
    "x",
  ]
  for (const sample of samples) {
    const port = derivePortFromCwd(sample)
    assert.ok(port >= 40000 && port <= 49999, `port ${port} out of range for ${sample}`)
  }
})

test("derivePortFromCwd differentiates between sibling project names", () => {
  const names = ["game-of-life", "tetris-clone", "pong", "platformer", "my-app"]
  const ports = new Set(names.map((name) => derivePortFromCwd(`/tmp/${name}`)))
  assert.equal(ports.size, names.length, "sibling basenames should not collide in this sample")
})

test("derivePortFromCwd honors an explicit range", () => {
  const port = derivePortFromCwd("/tmp/anything", { min: 60000, max: 60100 })
  assert.ok(port >= 60000 && port <= 60100)
})

test("derivePortFromCwd rejects inverted ranges", () => {
  assert.throws(() => derivePortFromCwd("/tmp/x", { min: 50000, max: 40000 }), /invalid range/)
})
