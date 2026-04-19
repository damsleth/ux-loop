import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { runApply } from "../src/commands/apply.mjs"

test("runApply rejects dirty worktrees before mutating anything", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-apply-dirty-"))
  const patchPath = path.join(dir, "change.patch")
  fs.writeFileSync(patchPath, "diff --git a/a.txt b/a.txt\n", "utf8")

  const commands = []

  try {
    await assert.rejects(
      () =>
        runApply([patchPath], dir, {
          loadConfig: async () => ({
            paths: {
              root: dir,
              diffsDir: path.join(dir, ".uxl", "diffs"),
            },
          }),
          assertCommandAvailable: () => {},
          runCommand: (_cmd, args) => {
            commands.push(args.join(" "))
            if (args[0] === "status") return { stdout: " M src/app.js\n" }
            return { stdout: "" }
          },
        }),
      /clean working tree/
    )

    assert.deepEqual(commands, ["status --porcelain"])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("runApply --commit stages deletions with git add -A", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-apply-commit-"))
  const patchPath = path.join(dir, "change.patch")
  fs.writeFileSync(
    patchPath,
    [
      "diff --git a/doomed.txt b/doomed.txt",
      "deleted file mode 100644",
      "index 1111111..0000000",
      "--- a/doomed.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
      "",
    ].join("\n"),
    "utf8"
  )

  const commands = []

  try {
    const result = await runApply([patchPath, "--commit"], dir, {
      loadConfig: async () => ({
        paths: {
          root: dir,
          diffsDir: path.join(dir, ".uxl", "diffs"),
        },
      }),
      assertCommandAvailable: () => {},
      runCommand: (_cmd, args) => {
        commands.push(args.join(" "))
        return { stdout: "" }
      },
    })

    assert.equal(result.committed, true)
    assert.deepEqual(commands, [
      "status --porcelain",
      `apply --check ${patchPath}`,
      `apply ${patchPath}`,
      "add -A",
      "commit -m chore: apply ux loop patch",
    ])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
