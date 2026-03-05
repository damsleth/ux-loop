import test from "node:test"
import assert from "node:assert/strict"

import {
  buildServerProbeUrls,
  createPlaywrightCaptureHarness,
  isServerReadyResponse,
  validatePlaywrightCaptureDefinition,
} from "../src/capture/playwright-harness.mjs"

test("validatePlaywrightCaptureDefinition accepts a valid declarative setup", () => {
  const valid = validatePlaywrightCaptureDefinition({
    devices: [
      { name: "mobile", width: 390, height: 844 },
      { name: "desktop", width: 1280, height: 800 },
    ],
    flows: [
      {
        label: "Home — Mobile vs Desktop",
        name: "home",
        path: "/",
        waitFor: "main",
        actions: [{ type: "wait", ms: 100 }],
        screenshot: { fullPage: true },
      },
    ],
  })

  assert.equal(valid, true)
})

test("validatePlaywrightCaptureDefinition rejects invalid device", () => {
  assert.throws(
    () =>
      validatePlaywrightCaptureDefinition({
        devices: [{ name: "tablet" }],
      }),
    /must set width\/height or playwrightDevice/
  )
})

test("validatePlaywrightCaptureDefinition rejects unsupported action types", () => {
  assert.throws(
    () =>
      validatePlaywrightCaptureDefinition({
        flows: [
          {
            label: "Bad Flow",
            name: "bad",
            actions: [{ type: "hoverMagic" }],
          },
        ],
      }),
    /Unsupported flow action type/
  )
})

test("createPlaywrightCaptureHarness fails fast on invalid flow definitions", () => {
  assert.throws(
    () =>
      createPlaywrightCaptureHarness({
        flows: [{ name: "missing-label" }],
      }),
    /Each flow must include a label/
  )
})

test("buildServerProbeUrls includes loopback aliases for localhost", () => {
  const urls = buildServerProbeUrls("http://localhost:5173/foo?x=1")

  assert.deepEqual(urls, [
    "http://localhost:5173/foo?x=1",
    "http://127.0.0.1:5173/foo?x=1",
    "http://[::1]:5173/foo?x=1",
    "http://0.0.0.0:5173/foo?x=1",
  ])
})

test("buildServerProbeUrls includes loopback aliases for 127.0.0.1", () => {
  const urls = buildServerProbeUrls("http://127.0.0.1:5173/")

  assert.deepEqual(urls, [
    "http://127.0.0.1:5173/",
    "http://localhost:5173/",
    "http://[::1]:5173/",
    "http://0.0.0.0:5173/",
  ])
})

test("buildServerProbeUrls treats any 127.x.x.x host as loopback", () => {
  const urls = buildServerProbeUrls("http://127.0.0.2:5173/")

  assert.deepEqual(urls, [
    "http://127.0.0.2:5173/",
    "http://localhost:5173/",
    "http://127.0.0.1:5173/",
    "http://[::1]:5173/",
    "http://0.0.0.0:5173/",
  ])
})

test("buildServerProbeUrls leaves non-loopback hosts unchanged", () => {
  const urls = buildServerProbeUrls("https://example.com/app")
  assert.deepEqual(urls, ["https://example.com/app"])
})

test("isServerReadyResponse accepts non-5xx responses", () => {
  assert.equal(isServerReadyResponse({ status: 200 }), true)
  assert.equal(isServerReadyResponse({ status: 302 }), true)
  assert.equal(isServerReadyResponse({ status: 404 }), true)
})

test("isServerReadyResponse rejects 5xx responses", () => {
  assert.equal(isServerReadyResponse({ status: 500 }), false)
  assert.equal(isServerReadyResponse({ status: 503 }), false)
})
