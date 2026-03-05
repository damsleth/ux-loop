# QA Report: @damsleth/ux-loop

**Version**: 1.0.1
**Date**: 2026-03-04
**Scope**: Full codebase audit — functionality, correctness, error handling, test coverage, code quality

---

## Test Suite Status

**Result: PASS — 69/69 tests passed, 0 failures, 0 skipped**

```
# tests 69
# pass 69
# fail 0
# cancelled 0
# skipped 0
# duration_ms 115
```

---

## Summary

The project is a well-structured ESM-only CLI tool for agentic UX pipelines. Core architecture is clean, concerns are well-separated, and the test suite covers all primary validation and business logic paths. No runtime failures were found during testing.

Several issues were identified spanning correctness bugs, missing error handling, behavioral inconsistencies, and robustness gaps. Issues are categorized by severity.

---

## Severity Legend

| Symbol | Severity | Meaning |
|--------|----------|---------|
| 🔴 | Critical | Incorrect behavior, data loss, or silent failure |
| 🟡 | Major | Feature gap, inconsistency, or likely user-facing failure |
| 🔵 | Minor | Code quality, edge case, or low-impact gap |

---

## 🔴 Critical Issues

## 🟡 Major Issues

## 🔵 Minor Issues

### m-4: Loopback alias logic limited to three addresses

**File**: [src/capture/playwright-harness.mjs](src/capture/playwright-harness.mjs)

The server loopback alias detection only handles `localhost`, `127.0.0.1`, and `::1`. Apps binding to `0.0.0.0` or `127.0.0.2` (common in Docker or multi-service setups) will not have aliases built, potentially causing connectivity failures.

---

### m-5: `detail: "high"` is hardcoded in the OpenAI runner

**File**: [src/runners/review-openai.mjs](src/runners/review-openai.mjs)

The image detail level is hardcoded to `"high"` with no config option to change it. High detail significantly increases token usage and cost. Users on tight budgets or using low-res screenshots have no way to opt for `"low"` or `"auto"`.

---

### m-7: `init.mjs` command parsing regex doesn't handle escaped quotes

**File**: [src/commands/init.mjs](src/commands/init.mjs)

`splitCommand()` tokenizes the user's dev server command using a simple regex. It does not handle escaped quotes or nested quotes. A command like `node -e "console.log('hello')"` would be tokenized incorrectly. This is a minor UX issue limited to the `--start-command` init flow.

---

### m-8: `runInit` interactive readline has no timeout

**File**: [src/commands/init.mjs](src/commands/init.mjs)

The interactive init flow waits indefinitely for user input via `readline`. If run in a CI pipeline or non-interactive context without `--yes`, it will hang. The `--yes` flag handles the happy path, but an unexpected invocation in CI would stall the process with no timeout or detection.

---

### m-9: `review-codex.mjs` temp dir not cleaned up on error

**File**: [src/runners/review-codex.mjs](src/runners/review-codex.mjs)

The runner creates a temp directory with `fs.mkdtempSync()` for the prompt file. The cleanup logic runs at the end of the function, but if `runCommandAsync()` throws, the temp dir is not cleaned up. Should use `try/finally`.

---

## Coverage Gaps

| Area | Gap |
|------|-----|
| `runPipeline` | No test for pipeline step sequencing or `stopOnError` behavior |
| `resolveReportInputPath` | No test for the "exists but prefer timestamped" edge case |
| `review-openai.mjs` | No test for missing API key or failed API call |
| `playwright-harness.mjs` | No test for `applyStatefulAction` or server startup/shutdown |
| `init.mjs` | No test for `splitCommand` with complex inputs |
| CLI routing | No test that unknown commands print help and exit non-zero |

---

## Code Quality Notes

| Area | Observation |
|------|-------------|
| No TypeScript | No static types; relies entirely on runtime validation |
| No JSDoc | No type hints in IDE for exported functions |
| Arg parsing | Custom per-command arg parsing; inconsistent (no short flags, no `=` in all parsers) |
| Deep nesting | `normalizeConfig` in [src/config/schema.mjs](src/config/schema.mjs) has up to 8 levels of nesting |
| Hardcoded constants | `REASONING_EFFORT_VALUES` duplicated; several magic strings inline |

---

## What's Working Well

- **All 69 tests pass** with no failures
- **Config validation** is thorough and produces clear error messages
- **Flow coverage system** is solid — gates prevent misconfigured runs
- **Command routing** is clear and easy to extend
- **Async process handling** in `process.mjs` is well-implemented with kill escalation and buffer protection
- **Progress animation** is TTY-aware and degrades gracefully
- **Cache-busting** in `config-file.mjs` correctly handles ESM import caching
- **Workspace CWD resolution** handles npm exec, `INIT_CWD`, and `UXL_CWD` correctly
- **Runner abstraction** cleanly separates AI backends behind a consistent interface

---

## Recommended Fixes by Priority

| Priority | Issue | File |
|----------|-------|------|
| 1 | Pass `reasoningEffort` to Copilot implement runner | implement.mjs |
| 2 | Validate OpenAI API key before use | review-openai.mjs |
| 3 | Fix silent failure in implement runners (return/throw) | implement-codex.mjs, implement-copilot.mjs |
| 4 | Wrap `loadRawConfig` import in try/catch with user-friendly error | config-file.mjs |
| 5 | Fix `countIssuesInCritique` fallback returning 1 for unstructured text | review.mjs |
| 6 | Add cleanup handler for worktree/branch on implementation failure | target-resolver.mjs |
| 7 | Extract `REASONING_EFFORT_VALUES` and validator to shared module | review.mjs, implement.mjs |
| 8 | Add `try/finally` cleanup for temp dir in Codex review runner | review-codex.mjs |
| 9 | Add tests for `runPipeline` and `resolveReportInputPath` | test/ |
| 10 | Document `stopOnError` in help text | cli.mjs |
