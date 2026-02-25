import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import os from "os"
import path from "path"

import { runShots } from "../src/commands/shots.mjs"
import { getConfigPath, writeConfigFile } from "../src/config/config-file.mjs"

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

function withTempCwd(fn) {
  const previous = process.cwd()
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-shots-gate-"))
  process.chdir(cwd)

  return Promise.resolve()
    .then(() => fn(cwd))
    .finally(() => process.chdir(previous))
}

test("runShots fails early when flow coverage is incomplete", async () => {
  await withTempCwd(async (cwd) => {
    installUxlStub(cwd)
    writeConfigFile(getConfigPath(cwd), {
      capture: {
        runner: "playwright",
        onboarding: { status: "pending" },
        flowInventory: [{ id: "home", label: "Home", path: "/", required: true }],
        flowMapping: {},
        playwright: {
          flows: [{ name: "home", label: "Home", path: "/", screenshot: { fullPage: true } }],
        },
      },
      review: { runner: "codex" },
      implement: { target: "worktree" },
    })

    await assert.rejects(() => runShots(), /Flow mapping is incomplete/)
  })
})

test("runShots proceeds when flow coverage is complete", async () => {
  await withTempCwd(async (cwd) => {
    installUxlStub(cwd)
    fs.writeFileSync(
      path.join(cwd, "uxl.capture.mjs"),
      `import fs from \"fs\"\n` +
        `import path from \"path\"\n` +
        `export async function captureUx(context) {\n` +
        `  const file = path.join(context.shotsDir, \"home-desktop.png\")\n` +
        `  fs.mkdirSync(context.shotsDir, { recursive: true })\n` +
        `  fs.writeFileSync(file, \"ok\")\n` +
        `  return [{ label: \"Home\", files: [file] }]\n` +
        `}\n`,
      "utf8"
    )

    writeConfigFile(getConfigPath(cwd), {
      capture: {
        runner: "playwright",
        adapter: "./uxl.capture.mjs",
        onboarding: { status: "complete" },
        flowInventory: [{ id: "home", label: "Home", path: "/", required: true }],
        flowMapping: { home: ["home"] },
        playwright: {
          flows: [{ name: "home", label: "Home", path: "/", screenshot: { fullPage: true } }],
        },
      },
      review: { runner: "codex" },
      implement: { target: "worktree" },
    })

    await runShots()

    const manifestPath = path.join(cwd, ".uxl", "shots", "manifest.json")
    assert.equal(fs.existsSync(manifestPath), true)
  })
})
