import test from "node:test"
import assert from "node:assert/strict"

import { EventEmitter } from "node:events"
import {
  applyStatefulAction,
  buildServerProbeUrls,
  createPlaywrightCaptureHarness,
  ensureServer,
  isServerReadyResponse,
  registerPlannedScreenshotPath,
  runBrowserCleanup,
  runWithBrowser,
  sanitizeArtifactFragment,
  verifyServerIdentity,
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

test("registerPlannedScreenshotPath allows distinct resolved paths", () => {
  const plannedPaths = new Map()
  registerPlannedScreenshotPath({
    plannedPaths,
    resolvedScreenshotPath: "/shots/a-desktop.png",
    screenshotPath: "/shots/a-desktop.png",
    rawScreenshotName: "a",
    rawDeviceName: "desktop",
    flowLabel: "Alpha",
  })
  registerPlannedScreenshotPath({
    plannedPaths,
    resolvedScreenshotPath: "/shots/b-desktop.png",
    screenshotPath: "/shots/b-desktop.png",
    rawScreenshotName: "b",
    rawDeviceName: "desktop",
    flowLabel: "Beta",
  })
  assert.equal(plannedPaths.size, 2)
})

test("registerPlannedScreenshotPath is idempotent for identical raw tuples", () => {
  const plannedPaths = new Map()
  const args = {
    plannedPaths,
    resolvedScreenshotPath: "/shots/same-desktop.png",
    screenshotPath: "/shots/same-desktop.png",
    rawScreenshotName: "same",
    rawDeviceName: "desktop",
    flowLabel: "Home",
  }
  registerPlannedScreenshotPath(args)
  assert.doesNotThrow(() => registerPlannedScreenshotPath(args))
  assert.equal(plannedPaths.size, 1)
})

test("registerPlannedScreenshotPath throws when sanitized names collide across flows", () => {
  const plannedPaths = new Map()
  registerPlannedScreenshotPath({
    plannedPaths,
    resolvedScreenshotPath: "/shots/nested-name-desktop.png",
    screenshotPath: "/shots/nested-name-desktop.png",
    rawScreenshotName: "nested/name",
    rawDeviceName: "desktop",
    flowLabel: "Flow A",
  })
  assert.throws(
    () =>
      registerPlannedScreenshotPath({
        plannedPaths,
        resolvedScreenshotPath: "/shots/nested-name-desktop.png",
        screenshotPath: "/shots/nested-name-desktop.png",
        rawScreenshotName: "nested-name",
        rawDeviceName: "desktop",
        flowLabel: "Flow B",
      }),
    /Sanitized screenshot collision.*Flow A.*Flow B/s
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

test("ensureServer fails fast with lsof hint when port is bound and reuseExistingServer=false", async () => {
  const silentLogger = { log() {}, warn() {} }
  let spawnCalls = 0

  await assert.rejects(
    () =>
      ensureServer({
        baseUrl: "http://127.0.0.1:44321",
        timeoutMs: 200,
        startCommand: { command: "fake", args: [] },
        env: {},
        cwd: process.cwd(),
        logger: silentLogger,
        spawnFn: () => {
          spawnCalls += 1
          return makeFakeProc()
        },
        waitForServerFn: async () => "http://127.0.0.1:44321/",
      }),
    (err) => {
      assert.match(err.message, /already in use; refusing to reuse it/)
      assert.match(err.message, /lsof -iTCP:44321 -sTCP:LISTEN/)
      assert.match(err.message, /reuseExistingServer: true/)
      return true
    }
  )
  assert.equal(spawnCalls, 0, "must not spawn when port is already bound")
})

test("ensureServer reuses existing server when reuseExistingServer=true", async () => {
  const silentLogger = { log() {}, warn() {} }
  let verifyCalls = 0

  const result = await ensureServer({
    baseUrl: "http://127.0.0.1:44322",
    timeoutMs: 200,
    startCommand: { command: "fake", args: [] },
    env: {},
    cwd: process.cwd(),
    logger: silentLogger,
    spawnFn: () => {
      throw new Error("should not spawn")
    },
    waitForServerFn: async () => "http://127.0.0.1:44322/",
    reuseExistingServer: true,
    expectTitleIncludes: "whatever",
    verifyIdentityFn: async () => {
      verifyCalls += 1
    },
  })

  assert.equal(result.proc, null)
  assert.equal(result.baseUrl, "http://127.0.0.1:44322/")
  assert.equal(verifyCalls, 1, "identity check must still run on reused server")
})

test("ensureServer runs identity check against reused server and surfaces its failure", async () => {
  let stopCalled = false
  const silentLogger = { log() {}, warn() {} }
  await assert.rejects(
    () =>
      ensureServer({
        baseUrl: "http://127.0.0.1:15999",
        timeoutMs: 200,
        startCommand: { command: "fake", args: [] },
        env: {},
        cwd: process.cwd(),
        logger: silentLogger,
        spawnFn: () => {
          stopCalled = true
          return makeFakeProc()
        },
        waitForServerFn: async () => "http://127.0.0.1:15999/",
        expectTitleIncludes: "my-app",
        reuseExistingServer: true,
        verifyIdentityFn: async () => {
          throw new Error("fingerprint mismatch on reused server")
        },
      }),
    /fingerprint mismatch on reused server/
  )
  assert.equal(stopCalled, false, "should not spawn when reused server is already ready")
})

test("ensureServer stops spawned server when identity check fails", async () => {
  const proc = makeFakeProc()
  let killed = false
  proc.kill = () => {
    killed = true
    queueMicrotask(() => proc.emit("exit", 0, null))
  }
  const silentLogger = { log() {}, warn() {} }
  let probeCalls = 0

  await assert.rejects(
    () =>
      ensureServer({
        baseUrl: "http://127.0.0.1:15999",
        timeoutMs: 200,
        startCommand: { command: "fake", args: [] },
        env: {},
        cwd: process.cwd(),
        logger: silentLogger,
        spawnFn: () => proc,
        waitForServerFn: async () => {
          probeCalls += 1
          return probeCalls === 1 ? null : "http://127.0.0.1:15999/"
        },
        expectTitleIncludes: "my-app",
        verifyIdentityFn: async () => {
          throw new Error("fingerprint mismatch after spawn")
        },
      }),
    /fingerprint mismatch after spawn/
  )

  assert.equal(killed, true, "spawned server must be killed when identity check fails")
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

test("runBrowserCleanup handles null browser and still stops the server", async () => {
  const calls = []
  await runBrowserCleanup({
    browser: null,
    server: { proc: { id: "proc" } },
    logger: { warn: () => {} },
    closeBrowser: async () => calls.push("close"),
    stopServer: async (proc) => calls.push(`stop:${proc.id}`),
  })

  assert.deepEqual(calls, ["stop:proc"])
})

test("runWithBrowser stops the server when chromium.launch throws", async () => {
  const cleanupCalls = []
  const serverProc = { id: "dev-server" }

  await assert.rejects(
    () =>
      runWithBrowser(
        { baseUrl: "http://127.0.0.1:45000", launch: {} },
        { rootDir: "/tmp", logger: { log() {}, warn() {} } },
        async () => "unused",
        {
          loadPlaywright: async () => ({
            chromium: {
              launch: async () => {
                throw new Error("launch boom")
              },
            },
            devices: {},
          }),
          ensureServer: async () => ({ proc: serverProc, baseUrl: "http://127.0.0.1:45000" }),
          runBrowserCleanup: async ({ browser, server }) => {
            cleanupCalls.push({ browser, serverProc: server?.proc })
          },
        }
      ),
    /launch boom/
  )

  assert.equal(cleanupCalls.length, 1)
  assert.equal(cleanupCalls[0].browser, null)
  assert.equal(cleanupCalls[0].serverProc, serverProc)
})

test("verifyServerIdentity passes when the title contains the expected substring", async () => {
  const fetchFn = async () => ({
    text: async () => "<html><head><title>MyApp &amp; Friends</title></head></html>",
  })
  const result = await verifyServerIdentity({
    baseUrl: "http://127.0.0.1:44000",
    expectTitleIncludes: "myapp",
    fetchFn,
    logger: { warn() {} },
  })
  assert.equal(result.checked, true)
  assert.equal(result.matched, true)
})

test("verifyServerIdentity throws with lsof hint when title does not match", async () => {
  const fetchFn = async () => ({
    text: async () => "<html><head><title>other-app</title></head></html>",
  })
  await assert.rejects(
    () =>
      verifyServerIdentity({
        baseUrl: "http://127.0.0.1:44123",
        expectTitleIncludes: "my-app",
        fetchFn,
        logger: { warn() {} },
      }),
    (err) => {
      assert.match(err.message, /does not match the expected fingerprint/)
      assert.match(err.message, /expected title to include: my-app/)
      assert.match(err.message, /actual title:\s+other-app/)
      assert.match(err.message, /lsof -iTCP:44123 -sTCP:LISTEN/)
      return true
    }
  )
})

test("verifyServerIdentity throws with response snippet when no title is found", async () => {
  const fetchFn = async () => ({
    text: async () => "<html><body>no title here, sorry</body></html>",
  })
  await assert.rejects(
    () =>
      verifyServerIdentity({
        baseUrl: "http://127.0.0.1:44000",
        expectTitleIncludes: "my-app",
        fetchFn,
        logger: { warn() {} },
      }),
    /did not return a parseable <title>[\s\S]*response snippet:\s*<html>/
  )
})

test("verifyServerIdentity skips when expectTitleIncludes is empty", async () => {
  const warnings = []
  const result = await verifyServerIdentity({
    baseUrl: "http://127.0.0.1:44000",
    expectTitleIncludes: "",
    fetchFn: async () => ({ text: async () => "" }),
    logger: { warn: (m) => warnings.push(m) },
  })
  assert.equal(result.checked, false)
  assert.equal(result.reason, "no-expectation")
  assert.equal(warnings.length, 1)
})

test("runWithBrowser invokes work and cleans up on success", async () => {
  const order = []
  const serverProc = { id: "proc" }
  const browserStub = { kind: "browser", close: async () => order.push("close") }

  const result = await runWithBrowser(
    { baseUrl: "http://127.0.0.1:45001" },
    { rootDir: "/tmp", logger: { log() {}, warn() {} } },
    async (args) => {
      order.push("work")
      return `${args.browser.kind}:${args.baseUrl}`
    },
    {
      loadPlaywright: async () => ({
        chromium: {
          launch: async () => {
            order.push("launch")
            return browserStub
          },
        },
        devices: {},
      }),
      ensureServer: async () => ({ proc: serverProc, baseUrl: "http://127.0.0.1:45001/" }),
      runBrowserCleanup: async ({ browser }) => {
        if (browser) await browser.close()
      },
    }
  )

  assert.equal(result, "browser:http://127.0.0.1:45001/")
  assert.deepEqual(order, ["launch", "work", "close"])
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
