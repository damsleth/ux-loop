import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import os from "os"
import path from "path"

import { runInit } from "../src/commands/init.mjs"
import { loadRawConfig } from "../src/config/config-file.mjs"

const EXPECTED_UXL_SCRIPTS = {
  "uxl:init": "uxl init",
  "uxl:flows": "uxl flows check",
  "uxl:shots": "uxl shots",
  "uxl:review": "uxl review",
  "uxl:implement": "uxl implement",
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
