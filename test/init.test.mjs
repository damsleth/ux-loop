import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import os from "os"
import path from "path"

import { runInit } from "../src/commands/init.mjs"
import { loadRawConfig } from "../src/config/config-file.mjs"

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
})
