import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { writeManifest } from "../src/manifest/write-manifest.mjs"

function withTmp(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-manifest-"))
  try {
    fn(tmpDir)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

test("writeManifest writes valid JSON with generatedAt and normalized groups", () => {
  withTmp((tmpDir) => {
    const manifestPath = path.join(tmpDir, "manifest.json")
    const result = writeManifest(manifestPath, [
      { label: "Home", files: ["/tmp/a.png", "/tmp/b.png"] },
    ])

    assert.ok(typeof result.generatedAt === "string")
    assert.equal(result.groups.length, 1)
    assert.equal(result.groups[0].label, "Home")
    assert.deepEqual(result.groups[0].files, ["/tmp/a.png", "/tmp/b.png"])

    const written = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    assert.deepEqual(written, result)
  })
})

test("writeManifest coerces file path entries to strings", () => {
  withTmp((tmpDir) => {
    const result = writeManifest(path.join(tmpDir, "m.json"), [
      { label: "Shot", files: [42] },
    ])
    assert.equal(result.groups[0].files[0], "42")
  })
})

test("writeManifest creates parent directories when they do not exist", () => {
  withTmp((tmpDir) => {
    const nested = path.join(tmpDir, "a", "b", "manifest.json")
    writeManifest(nested, [{ label: "X", files: ["shot.png"] }])
    assert.ok(fs.existsSync(nested))
  })
})

test("writeManifest trims label whitespace and throws when result is empty", () => {
  withTmp((tmpDir) => {
    assert.throws(
      () => writeManifest(path.join(tmpDir, "m.json"), [{ label: "   ", files: ["a.png"] }]),
      /non-empty label/
    )
  })
})

test("writeManifest throws when files array is empty", () => {
  withTmp((tmpDir) => {
    assert.throws(
      () => writeManifest(path.join(tmpDir, "m.json"), [{ label: "Empty", files: [] }]),
      /non-empty files array/
    )
  })
})

test("writeManifest throws when group is not an object", () => {
  withTmp((tmpDir) => {
    assert.throws(
      () => writeManifest(path.join(tmpDir, "m.json"), ["not-an-object"]),
      /group objects/
    )
  })
})

test("writeManifest preserves metrics field when present on group", () => {
  withTmp((tmpDir) => {
    const metrics = {
      axe: { critical: 0, serious: 1, moderate: 0, minor: 2 },
      heuristics: { viewportMeta: true, smallTapTargets: 1, lowContrastSamples: 0, fontSizeCount: 3 },
    }
    const result = writeManifest(path.join(tmpDir, "m.json"), [
      { label: "Home", files: ["a.png"], metrics },
    ])
    assert.deepEqual(result.groups[0].metrics, metrics)
    const written = JSON.parse(fs.readFileSync(path.join(tmpDir, "m.json"), "utf8"))
    assert.deepEqual(written.groups[0].metrics, metrics)
  })
})

test("writeManifest omits metrics field when not provided", () => {
  withTmp((tmpDir) => {
    const result = writeManifest(path.join(tmpDir, "m.json"), [
      { label: "Home", files: ["a.png"] },
    ])
    assert.equal("metrics" in result.groups[0], false)
  })
})
