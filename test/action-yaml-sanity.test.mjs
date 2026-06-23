import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// No YAML parser is available as a dependency, so this is a structural sanity
// check, not full validation. actionlint covers the real linting in CI.
function assertNoTabsAndBalanced(text, label) {
  assert.ok(!text.includes("\t"), `${label} must not contain tabs (YAML forbids them for indentation)`)
  // Every "- name:" step line should be indented consistently (multiple of 2 spaces).
  for (const line of text.split(/\r?\n/)) {
    const indent = line.match(/^( *)\S/)
    if (indent) assert.equal(indent[1].length % 2, 0, `${label}: odd indent on line: ${line}`)
  }
}

test("action.yml is a well-formed composite action with the expected surface", () => {
  const text = fs.readFileSync(path.join(root, "action.yml"), "utf8")
  assertNoTabsAndBalanced(text, "action.yml")
  assert.match(text, /using:\s*"composite"/)
  // Inputs documented in the README table.
  for (const input of ["working-directory", "runner", "model", "fail-under", "comment", "node-version"]) {
    assert.match(text, new RegExp(`^  ${input}:`, "m"), `missing input: ${input}`)
  }
  // Must run shots + review explicitly and never implement.
  assert.match(text, /uxl shots/)
  assert.match(text, /uxl review --runner/)
  assert.ok(!/uxl run\b/.test(text), "action must not call `uxl run` (would risk implement in CI)")
  assert.ok(!/uxl implement\b/.test(text), "action must never implement in CI")
  // Sticky comment anchor + gate.
  assert.match(text, /uxl-report/)
  assert.match(text, /uxl report --format github/)
  assert.match(text, /uxl report --fail-under/)
})

test("examples/uxl-pr-review.yml wires checkout, the action, and PR-write permissions", () => {
  const text = fs.readFileSync(path.join(root, "examples", "uxl-pr-review.yml"), "utf8")
  assertNoTabsAndBalanced(text, "examples/uxl-pr-review.yml")
  assert.match(text, /on:\s*pull_request/)
  assert.match(text, /pull-requests:\s*write/)
  assert.match(text, /uses:\s*damsleth\/ux-loop@v1/)
  assert.match(text, /ANTHROPIC_API_KEY:\s*\$\{\{\s*secrets\.ANTHROPIC_API_KEY\s*\}\}/)
})
