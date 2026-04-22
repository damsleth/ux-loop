import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import os from "os"
import path from "path"

import { runInit, splitCommand } from "../src/commands/init.mjs"
import { loadRawConfig } from "../src/config/config-file.mjs"

const EXPECTED_UXL_SCRIPTS = {
  "uxl:init": "uxl init",
  "uxl:flows": "uxl flows check",
  "uxl:shots": "uxl shots",
  "uxl:review": "uxl review",
  "uxl:implement": "uxl implement",
  "uxl:diff": "uxl diff",
  "uxl:apply": "uxl apply",
  "uxl:rollback": "uxl rollback",
  "uxl:report": "uxl report",
  "uxl:run": "uxl run",
}

function installUxlStub(cwd) {
  const packageDir = path.join(cwd, "node_modules", "@damsleth", "ux-loop")
  fs.mkdirSync(packageDir, { recursive: true })
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify(
      {
        name: "@damsleth/ux-loop",
        type: "module",
        exports: "./index.js",
      },
      null,
      2
    ),
    "utf8"
  )
  fs.writeFileSync(
    path.join(packageDir, "index.js"),
    "export function defineUxlConfig(config) { return config }\n",
    "utf8"
  )
}

test("runInit interactive marks onboarding complete after explicit confirmation", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-init-interactive-"))
  installUxlStub(cwd)

  const scaffold = {
    source: "route-scan",
    files: [],
    inventory: [{ id: "home", label: "Home", path: "/", required: true }],
    flows: [{ name: "home", label: "Home", path: "/", screenshot: { fullPage: true } }],
    flowMapping: { home: ["home"] },
  }

  await runInit([], cwd, {
    isInteractive: true,
    detectPlaywrightInstalled: () => true,
    buildFlowScaffold: () => scaffold,
    prompt: async () => "yes",
    logger: { log: () => {} },
  })

  const { raw } = await loadRawConfig(cwd)
  assert.equal(raw.capture.onboarding.status, "complete")
})

test("runInit non-interactive keeps onboarding pending", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-init-noninteractive-"))
  installUxlStub(cwd)

  const scaffold = {
    source: "route-scan",
    files: [],
    inventory: [{ id: "home", label: "Home", path: "/", required: true }],
    flows: [{ name: "home", label: "Home", path: "/", screenshot: { fullPage: true } }],
    flowMapping: { home: ["home"] },
  }

  await runInit(["--non-interactive"], cwd, {
    detectPlaywrightInstalled: () => true,
    buildFlowScaffold: () => scaffold,
    logger: { log: () => {} },
  })

  const { raw } = await loadRawConfig(cwd)
  assert.equal(raw.capture.onboarding.status, "pending")

  const packageJsonPath = path.join(cwd, "package.json")
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
  for (const [name, command] of Object.entries(EXPECTED_UXL_SCRIPTS)) {
    assert.equal(packageJson.scripts[name], command)
  }
})

test("runInit preserves existing scripts while adding missing uxl scripts", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-init-scripts-"))
  installUxlStub(cwd)

  fs.writeFileSync(
    path.join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "example-app",
        scripts: {
          test: "vitest",
          "uxl:shots": "custom-shots",
        },
      },
      null,
      2
    ),
    "utf8"
  )

  const scaffold = {
    source: "route-scan",
    files: [],
    inventory: [{ id: "home", label: "Home", path: "/", required: true }],
    flows: [{ name: "home", label: "Home", path: "/", screenshot: { fullPage: true } }],
    flowMapping: { home: ["home"] },
  }

  await runInit(["--non-interactive"], cwd, {
    detectPlaywrightInstalled: () => true,
    buildFlowScaffold: () => scaffold,
    logger: { log: () => {} },
  })

  const packageJson = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"))
  assert.equal(packageJson.scripts.test, "vitest")
  assert.equal(packageJson.scripts["uxl:shots"], "custom-shots")
  assert.equal(packageJson.scripts["uxl:run"], "uxl run")
  assert.equal(packageJson.scripts["uxl:init"], "uxl init")
})

test("runInit reads existing playwright config for baseURL and webServer command", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-init-playwright-config-"))
  installUxlStub(cwd)

  fs.writeFileSync(
    path.join(cwd, "playwright.config.ts"),
    [
      "import { defineConfig } from '@playwright/test'",
      "",
      "export default defineConfig({",
      "  use: {",
      "    baseURL: 'http://127.0.0.1:3000',",
      "  },",
      "  webServer: {",
      "    command: 'pnpm dev --port 3000',",
      "  },",
      "})",
      "",
    ].join("\n"),
    "utf8"
  )

  const scaffold = {
    source: "route-scan",
    files: [],
    inventory: [{ id: "home", label: "Home", path: "/", required: true }],
    flows: [{ name: "home", label: "Home", path: "/", screenshot: { fullPage: true } }],
    flowMapping: { home: ["home"] },
  }

  const previousUiReviewBaseUrl = process.env.UI_REVIEW_BASE_URL
  delete process.env.UI_REVIEW_BASE_URL
  try {
    await runInit(["--non-interactive"], cwd, {
      detectPlaywrightInstalled: () => true,
      buildFlowScaffold: () => scaffold,
      logger: { log: () => {} },
    })

    const { raw } = await loadRawConfig(cwd)
    assert.equal(raw.capture.baseUrl, "http://127.0.0.1:3000")
    assert.deepEqual(raw.capture.playwright.startCommand, {
      command: "pnpm",
      args: ["dev", "--port", "3000"],
    })
  } finally {
    if (previousUiReviewBaseUrl === undefined) {
      delete process.env.UI_REVIEW_BASE_URL
    } else {
      process.env.UI_REVIEW_BASE_URL = previousUiReviewBaseUrl
    }
  }
})

test("splitCommand handles nested quotes in -e scripts", () => {
  const parsed = splitCommand("node -e \"console.log('hello')\"")
  assert.deepEqual(parsed, {
    command: "node",
    args: ["-e", "console.log('hello')"],
  })
})

test("splitCommand handles escaped quotes", () => {
  const parsed = splitCommand('node -e "console.log(\\"hi\\")"')
  assert.deepEqual(parsed, {
    command: "node",
    args: ["-e", 'console.log("hi")'],
  })
})

test("splitCommand parses a single leading env assignment", () => {
  const parsed = splitCommand("HOST=127.0.0.1 npm run dev")
  assert.deepEqual(parsed, {
    command: "npm",
    args: ["run", "dev"],
    env: { HOST: "127.0.0.1" },
  })
})

test("splitCommand parses multiple leading env assignments", () => {
  const parsed = splitCommand("NODE_ENV=test PORT=3000 next dev")
  assert.deepEqual(parsed, {
    command: "next",
    args: ["dev"],
    env: { NODE_ENV: "test", PORT: "3000" },
  })
})

test("splitCommand leaves plain commands without an env key", () => {
  const parsed = splitCommand("pnpm dev --port 3000")
  assert.deepEqual(parsed, {
    command: "pnpm",
    args: ["dev", "--port", "3000"],
  })
})

test("splitCommand preserves quoted env values with spaces", () => {
  const parsed = splitCommand('FOO="bar baz" npm start')
  assert.deepEqual(parsed, {
    command: "npm",
    args: ["start"],
    env: { FOO: "bar baz" },
  })
})

test("splitCommand returns null when only env assignments are given", () => {
  assert.equal(splitCommand("FOO=bar BAR=baz"), null)
})

test("runInit bakes a repo-unique port into baseUrl and startCommand", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-init-port-"))
  const cwdA = path.join(parent, "game-of-life")
  const cwdB = path.join(parent, "tetris-clone")
  fs.mkdirSync(cwdA)
  fs.mkdirSync(cwdB)
  installUxlStub(cwdA)
  installUxlStub(cwdB)

  const scaffold = {
    source: "route-scan",
    files: [],
    inventory: [{ id: "home", label: "Home", path: "/", required: true }],
    flows: [{ name: "home", label: "Home", path: "/", screenshot: { fullPage: true } }],
    flowMapping: { home: ["home"] },
  }

  const resultA = await runInit(["--non-interactive"], cwdA, {
    detectPlaywrightInstalled: () => true,
    buildFlowScaffold: () => scaffold,
    logger: { log: () => {} },
  })
  const resultB = await runInit(["--non-interactive"], cwdB, {
    detectPlaywrightInstalled: () => true,
    buildFlowScaffold: () => scaffold,
    logger: { log: () => {} },
  })

  assert.notEqual(resultA.port, resultB.port, "sibling basenames should pick different ports")
  assert.ok(resultA.port >= 40000 && resultA.port <= 49999)
  assert.ok(resultB.port >= 40000 && resultB.port <= 49999)

  const { raw: rawA } = await loadRawConfig(cwdA)
  assert.equal(rawA.capture.baseUrl, `http://127.0.0.1:${resultA.port}`)
  assert.deepEqual(rawA.capture.playwright.startCommand, {
    command: "npm",
    args: ["run", "dev", "--", "--port", String(resultA.port)],
  })
})

test("runInit logs the chosen port in the summary", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-init-port-log-"))
  installUxlStub(cwd)

  const scaffold = {
    source: "route-scan",
    files: [],
    inventory: [{ id: "home", label: "Home", path: "/", required: true }],
    flows: [{ name: "home", label: "Home", path: "/", screenshot: { fullPage: true } }],
    flowMapping: { home: ["home"] },
  }

  const logs = []
  const result = await runInit(["--non-interactive"], cwd, {
    detectPlaywrightInstalled: () => true,
    buildFlowScaffold: () => scaffold,
    logger: { log: (msg) => logs.push(String(msg)) },
  })

  const portMentioned = logs.some((line) => line.includes(`${result.port}`))
  assert.ok(portMentioned, `expected logs to mention port ${result.port}; got: ${logs.join(" | ")}`)
})

test("runInit keeps an existing Playwright port and warns on mismatch", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-init-port-migration-"))
  installUxlStub(cwd)

  fs.writeFileSync(
    path.join(cwd, "playwright.config.ts"),
    [
      "import { defineConfig } from '@playwright/test'",
      "",
      "export default defineConfig({",
      "  use: {",
      "    baseURL: 'http://127.0.0.1:5173',",
      "  },",
      "  webServer: {",
      "    command: 'npm run dev -- --port 5173',",
      "  },",
      "})",
      "",
    ].join("\n"),
    "utf8"
  )

  const scaffold = {
    source: "route-scan",
    files: [],
    inventory: [{ id: "home", label: "Home", path: "/", required: true }],
    flows: [{ name: "home", label: "Home", path: "/", screenshot: { fullPage: true } }],
    flowMapping: { home: ["home"] },
  }

  const logs = []
  const result = await runInit(["--non-interactive"], cwd, {
    detectPlaywrightInstalled: () => true,
    buildFlowScaffold: () => scaffold,
    logger: { log: (msg) => logs.push(String(msg)) },
  })

  assert.equal(result.port, 5173)
  assert.notEqual(result.derivedPort, 5173)
  const warned = logs.some((line) => line.includes("Keeping Playwright-detected port 5173"))
  assert.ok(warned, `expected mismatch warning, got: ${logs.join(" | ")}`)

  const { raw } = await loadRawConfig(cwd)
  assert.equal(raw.capture.baseUrl, "http://127.0.0.1:5173")
  assert.deepEqual(raw.capture.playwright.startCommand, {
    command: "npm",
    args: ["run", "dev", "--", "--port", "5173"],
  })
})

test("runInit uses PORT from webServer env assignment when baseURL has no port", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-init-env-port-"))
  installUxlStub(cwd)

  fs.writeFileSync(
    path.join(cwd, "playwright.config.ts"),
    [
      "import { defineConfig } from '@playwright/test'",
      "",
      "export default defineConfig({",
      "  webServer: {",
      "    command: 'PORT=3000 npm run dev',",
      "  },",
      "})",
      "",
    ].join("\n"),
    "utf8"
  )

  const scaffold = {
    source: "route-scan",
    files: [],
    inventory: [{ id: "home", label: "Home", path: "/", required: true }],
    flows: [{ name: "home", label: "Home", path: "/", screenshot: { fullPage: true } }],
    flowMapping: { home: ["home"] },
  }

  const logs = []
  const result = await runInit(["--non-interactive"], cwd, {
    detectPlaywrightInstalled: () => true,
    buildFlowScaffold: () => scaffold,
    logger: { log: (msg) => logs.push(String(msg)) },
  })

  assert.equal(result.port, 3000)
  assert.equal(result.portSource, "webserver-env")
  const sourceLogged = logs.some((line) => line.includes("webServer env") && line.includes("PORT=3000"))
  assert.ok(sourceLogged, `expected env source log, got: ${logs.join(" | ")}`)

  const { raw } = await loadRawConfig(cwd)
  assert.equal(raw.capture.baseUrl, "http://127.0.0.1:3000")
})

test("runInit falls back to framework default when preserved webServer command has no port", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-init-no-port-"))
  installUxlStub(cwd)

  fs.writeFileSync(
    path.join(cwd, "playwright.config.ts"),
    [
      "import { defineConfig } from '@playwright/test'",
      "",
      "export default defineConfig({",
      "  webServer: {",
      "    command: 'HOST=127.0.0.1 npm run dev',",
      "  },",
      "})",
      "",
    ].join("\n"),
    "utf8"
  )

  const scaffold = {
    source: "route-scan",
    files: [],
    inventory: [{ id: "home", label: "Home", path: "/", required: true }],
    flows: [{ name: "home", label: "Home", path: "/", screenshot: { fullPage: true } }],
    flowMapping: { home: ["home"] },
  }

  const logs = []
  const result = await runInit(["--non-interactive"], cwd, {
    detectPlaywrightInstalled: () => true,
    buildFlowScaffold: () => scaffold,
    logger: { log: (msg) => logs.push(String(msg)) },
  })

  assert.equal(result.port, 5173)
  assert.equal(result.portSource, "framework-default")
  const warned = logs.some((line) => line.includes("framework default"))
  assert.ok(warned, `expected framework-default warning, got: ${logs.join(" | ")}`)

  const { raw } = await loadRawConfig(cwd)
  assert.equal(raw.capture.baseUrl, "http://127.0.0.1:5173")
  assert.deepEqual(raw.capture.playwright.startCommand, {
    command: "npm",
    args: ["run", "dev"],
    env: { HOST: "127.0.0.1" },
  })
})

test("runInit interactive prompt times out with clear error", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-init-timeout-"))
  installUxlStub(cwd)

  const never = async () => new Promise(() => {})

  await assert.rejects(
    () =>
      runInit([], cwd, {
        isInteractive: true,
        detectPlaywrightInstalled: () => false,
        buildFlowScaffold: () => ({
          source: "route-scan",
          files: [],
          inventory: [{ id: "home", label: "Home", path: "/", required: true }],
          flows: [{ name: "home", label: "Home", path: "/", screenshot: { fullPage: true } }],
          flowMapping: { home: ["home"] },
        }),
        prompt: never,
        promptTimeoutMs: 10,
        logger: { log: () => {} },
      }),
    /Init prompt timed out/
  )
})
