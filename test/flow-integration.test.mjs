import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import http from "http"
import os from "os"
import path from "path"

import { createPlaywrightCaptureHarness } from "../src/capture/playwright-harness.mjs"

async function canLoadPlaywright() {
  try {
    await import("playwright")
    return true
  } catch {
    return false
  }
}

function startFixtureServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const targetPath = req.url === "/" ? "/index.html" : req.url
      const filePath = path.join(rootDir, targetPath)
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(fs.readFileSync(filePath, "utf8"))
    })

    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      })
    })
  })
}

test("capture harness produces a non-empty screenshot for the fixture app", async (t) => {
  if (!(await canLoadPlaywright())) {
    t.skip("playwright is not installed")
    return
  }

  const fixtureRoot = path.resolve("test/fixtures/test-app")
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-flow-fixture-"))
  const shotsDir = path.join(tempRoot, "shots")
  const { server, baseUrl } = await startFixtureServer(fixtureRoot)
  t.after(() => server.close())

  const capture = createPlaywrightCaptureHarness({
    baseUrl,
    devices: [{ name: "desktop", width: 1280, height: 800 }],
    flows: [
      {
        label: "Fixture Home",
        name: "fixture-home",
        path: "/",
        waitFor: "[data-testid='hero']",
        screenshot: { fullPage: true },
      },
    ],
  })

  const groups = await capture({
    rootDir: tempRoot,
    shotsDir,
    baseUrl,
    logger: { log() {}, warn() {} },
  })

  assert.equal(groups.length, 1)
  assert.equal(groups[0].files.length, 1)
  const screenshotPath = groups[0].files[0]
  assert.equal(fs.existsSync(screenshotPath), true)
  assert.ok(fs.statSync(screenshotPath).size > 0)
})
