import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import os from "os"
import path from "path"

import { runFlows } from "../src/commands/flows.mjs"
import { writeConfigFile, loadRawConfig, getConfigPath } from "../src/config/config-file.mjs"

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

function writeBaseConfig(cwd, overrides = {}) {
  const configPath = getConfigPath(cwd)
  const base = {
    capture: {
      runner: "playwright",
      onboarding: { status: "pending" },
      flowInventory: [{ id: "home", label: "Home", path: "/", required: true }],
      flowMapping: { home: ["home"] },
      playwright: {
        startCommand: "dev",
        flows: [{ name: "home", label: "Home", path: "/", screenshot: { fullPage: true } }],
      },
    },
    review: { runner: "codex" },
    implement: { target: "worktree" },
    ...overrides,
  }

  writeConfigFile(configPath, base)
}

test("runFlows add appends inventory and mapping", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-flows-add-"))
  installUxlStub(cwd)
  writeBaseConfig(cwd)

  await runFlows(["add", "--id", "checkout", "--label", "Checkout"], cwd)

  const { raw } = await loadRawConfig(cwd)
  const entry = raw.capture.flowInventory.find((item) => item.id === "checkout")

  assert.ok(entry)
  assert.deepEqual(raw.capture.flowMapping.checkout, ["checkout"])
})

test("runFlows check throws when required inventory is unmapped", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-flows-check-"))
  installUxlStub(cwd)
  writeBaseConfig(cwd, {
    capture: {
      runner: "playwright",
      onboarding: { status: "pending" },
      flowInventory: [
        { id: "home", label: "Home", path: "/", required: true },
        { id: "checkout", label: "Checkout", path: "/checkout", required: true },
      ],
      flowMapping: { home: ["home"] },
      playwright: {
        startCommand: "dev",
        flows: [{ name: "home", label: "Home", path: "/", screenshot: { fullPage: true } }],
      },
    },
  })

  await assert.rejects(() => runFlows(["check"], cwd), /incomplete/)
})

test("runFlows import-playwright applies suggestions and keeps onboarding pending", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-flows-import-"))
  installUxlStub(cwd)
  writeBaseConfig(cwd)

  const e2eDir = path.join(cwd, "e2e")
  fs.mkdirSync(e2eDir, { recursive: true })
  fs.writeFileSync(
    path.join(e2eDir, "home.spec.ts"),
    `import { test } from "@playwright/test"\n\n` +
      `test("Visit About", async ({ page }) => {\n` +
      `  await page.goto("/about")\n` +
      `})\n`,
    "utf8"
  )

  await runFlows(["import-playwright", "--yes"], cwd)

  const { raw } = await loadRawConfig(cwd)
  const hasImported = raw.capture.flowInventory.some((item) => item.path === "/about")

  assert.equal(hasImported, true)
  assert.equal(raw.capture.onboarding.status, "pending")
})
