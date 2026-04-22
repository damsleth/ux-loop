import test from "node:test"
import assert from "node:assert/strict"

import { EventEmitter } from "node:events"
import {
  applyStatefulAction,
  buildServerProbeUrls,
  createPlaywrightCaptureHarness,
  ensureServer,
  isServerReadyResponse,
  runBrowserCleanup,
  sanitizeArtifactFragment,
  validatePlaywrightCaptureDefinition,
} from "../src/capture/playwright-harness.mjs"

function makeFakeProc() {
  const proc = new EventEmitter()
  proc.exitCode = null
  proc.signalCode = null
  proc.kill = () => {
    proc.exitCode = 0
    queueMicrotask(() => proc.emit("exit", 0, null))
  }
  proc.off = proc.removeListener.bind(proc)
  return proc
}

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

test("sanitizeArtifactFragment strips traversal and path separators", () => {
  assert.equal(
    sanitizeArtifactFragment("../escape", { kind: "flow name", context: "flow" }),
    "escape"
  )
  assert.equal(
    sanitizeArtifactFragment("nested/name", { kind: "flow name", context: "flow" }),
    "nested-name"
  )
  assert.equal(
    sanitizeArtifactFragment("a\\b\\c", { kind: "flow name", context: "flow" }),
    "a-b-c"
  )
})

test("sanitizeArtifactFragment passes through ordinary names unchanged", () => {
  assert.equal(
    sanitizeArtifactFragment("home", { kind: "flow name", context: "flow" }),
    "home"
  )
  assert.equal(
    sanitizeArtifactFragment("login-flow_1", { kind: "flow name", context: "flow" }),
    "login-flow_1"
  )
  assert.equal(
    sanitizeArtifactFragment("iPhone.12", { kind: "device name", context: "flow" }),
    "iPhone.12"
  )
})

test("sanitizeArtifactFragment rejects names that cannot be normalized", () => {
  assert.throws(
    () => sanitizeArtifactFragment("..", { kind: "flow name", context: "flow \"X\"" }),
    /Invalid flow name/
  )
  assert.throws(
    () => sanitizeArtifactFragment("/", { kind: "device name", context: "flow \"X\"" }),
    /Invalid device name/
  )
  assert.throws(
    () => sanitizeArtifactFragment("\0\0\0", { kind: "flow name", context: "flow" }),
    /Invalid flow name/
  )
})

function makeStagedWaitForServer() {
  let calls = 0
  return async (_url, ms) => {
    calls += 1
    if (calls === 1) return null
    await new Promise((r) => setTimeout(r, ms))
    return null
  }
}

test("ensureServer surfaces spawn errors immediately without waiting for readiness", async () => {
  const proc = makeFakeProc()
  const silentLogger = { log() {}, warn() {} }

  const promise = ensureServer({
    baseUrl: "http://127.0.0.1:15999",
    timeoutMs: 200,
    startCommand: { command: "/bin/definitely-not-real", args: [] },
    env: {},
    cwd: process.cwd(),
    logger: silentLogger,
    spawnFn: () => {
      setTimeout(() => {
        const err = new Error("spawn /bin/definitely-not-real ENOENT")
        err.code = "ENOENT"
        proc.emit("error", err)
      }, 10)
      return proc
    },
    waitForServerFn: makeStagedWaitForServer(),
  })

  await assert.rejects(promise, /failed to start.*ENOENT/)
})

test("ensureServer surfaces early exit before readiness timeout", async () => {
  const proc = makeFakeProc()
  const silentLogger = { log() {}, warn() {} }

  const promise = ensureServer({
    baseUrl: "http://127.0.0.1:15999",
    timeoutMs: 200,
    startCommand: { command: "fake", args: [] },
    env: {},
    cwd: process.cwd(),
    logger: silentLogger,
    spawnFn: () => {
      setTimeout(() => proc.emit("exit", 1, null), 10)
      return proc
    },
    waitForServerFn: makeStagedWaitForServer(),
  })

  await assert.rejects(promise, /exited before becoming ready.*code=1/)
})

test("ensureServer merges startCommand.env into spawn environment", async () => {
  const proc = makeFakeProc()
  const silentLogger = { log() {}, warn() {} }
  let capturedSpawnOptions = null

  await ensureServer({
    baseUrl: "http://127.0.0.1:15999/",
    timeoutMs: 200,
    startCommand: { command: "fake", args: ["start"], env: { HOST: "127.0.0.1", PORT: "4173" } },
    env: { PATH: "/usr/bin", NODE_ENV: "test" },
    cwd: process.cwd(),
    logger: silentLogger,
    spawnFn: (_cmd, _args, options) => {
      capturedSpawnOptions = options
      return proc
    },
    waitForServerFn: (() => {
      let calls = 0
      return async () => {
        calls += 1
        return calls === 1 ? null : "http://127.0.0.1:15999/"
      }
    })(),
  })

  assert.equal(capturedSpawnOptions.env.HOST, "127.0.0.1")
  assert.equal(capturedSpawnOptions.env.PORT, "4173")
  assert.equal(capturedSpawnOptions.env.NODE_ENV, "test")
  assert.equal(capturedSpawnOptions.env.PATH, "/usr/bin")
})

test("ensureServer resolves normally when the server becomes ready", async () => {
  const proc = makeFakeProc()
  const silentLogger = { log() {}, warn() {} }
  let probeCalls = 0

  const result = await ensureServer({
    baseUrl: "http://127.0.0.1:15999/",
    timeoutMs: 5000,
    startCommand: { command: "fake", args: [] },
    env: {},
    cwd: process.cwd(),
    logger: silentLogger,
    spawnFn: () => proc,
    waitForServerFn: async () => {
      probeCalls += 1
      return probeCalls === 1 ? null : "http://127.0.0.1:15999/"
    },
  })

  assert.equal(result.baseUrl, "http://127.0.0.1:15999/")
  assert.equal(result.proc, proc)
  assert.equal(proc.listenerCount("error"), 0)
  assert.equal(proc.listenerCount("exit"), 0)
})

test("runBrowserCleanup stops server even when browser.close throws", async () => {
  const calls = []
  const warnings = []
  await runBrowserCleanup({
    browser: { id: "browser" },
    server: { proc: { id: "proc" } },
    logger: { warn: (msg) => warnings.push(msg) },
    closeBrowser: async () => {
      calls.push("close")
      throw new Error("boom")
    },
    stopServer: async (proc) => {
      calls.push(`stop:${proc.id}`)
    },
  })

  assert.deepEqual(calls, ["close", "stop:proc"])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /browser\.close failed: boom/)
})

test("runBrowserCleanup logs and swallows stopServer failures", async () => {
  const warnings = []
  await runBrowserCleanup({
    browser: {},
    server: { proc: {} },
    logger: { warn: (msg) => warnings.push(msg) },
    closeBrowser: async () => {},
    stopServer: async () => {
      throw new Error("stop-boom")
    },
  })

  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /stopServerProcess failed: stop-boom/)
})

test("runBrowserCleanup skips stopServer when no server proc", async () => {
  const calls = []
  await runBrowserCleanup({
    browser: {},
    server: { proc: null },
    logger: { warn: () => {} },
    closeBrowser: async () => calls.push("close"),
    stopServer: async () => calls.push("stop"),
  })

  assert.deepEqual(calls, ["close"])
})

test("applyStatefulAction storeFirstLink and gotoStored share runtime state", async () => {
  const runtime = {}
  const calls = []

  const page = {
    locator(selector) {
      return {
        first() {
          return {
            async getAttribute() {
              return "/profile"
            },
          }
        },
      }
    },
    async goto(url) {
      calls.push(url)
    },
    async waitForSelector() {},
    async waitForTimeout() {},
  }

  await applyStatefulAction(page, { type: "storeFirstLink", selector: "a", storeAs: "next" }, runtime, "http://localhost:5173")
  await applyStatefulAction(page, { type: "gotoStored", key: "next" }, runtime, "http://localhost:5173")

  assert.equal(runtime.next, "http://localhost:5173/profile")
  assert.deepEqual(calls, ["http://localhost:5173/profile"])
})
