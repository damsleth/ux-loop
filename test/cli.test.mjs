import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

test("cli unknown command prints help and exits non-zero", () => {
  const result = spawnSync(process.execPath, ["src/cli.mjs", "unknown-cmd"], {
    cwd: repoRoot,
    encoding: "utf8",
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /Usage:/)
  assert.match(result.stderr, /Unknown command: unknown-cmd/)
})
