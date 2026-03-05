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

### C-2: Implement runners return no value — failures are silent

**Files**: [src/runners/implement-codex.mjs](src/runners/implement-codex.mjs), [src/runners/implement-copilot.mjs](src/runners/implement-copilot.mjs)

Both `runCodexImplement()` and `runCopilotImplement()` call `runCommandAsync()` or `runCommand()` but do not `return` the result or `await` a Promise (in the Copilot case). The caller in `implement.mjs` has no way to detect if the implementation succeeded or failed.

The `runPipeline()` command in [src/commands/run.mjs](src/commands/run.mjs) assumes success if no exception is thrown. Codex and Copilot can exit with non-zero codes without throwing in the current setup.

---

### C-3: OpenAI API key not validated before use

**File**: [src/runners/review-openai.mjs](src/runners/review-openai.mjs)

The OpenAI runner receives `apiKey: process.env[config.review.openai.apiKeyEnv]`, but does not check whether the value is set before constructing the client. A missing key will produce an OpenAI SDK error deep in the API call stack, with no actionable message to the user.

**Expected behavior**: Throw early with a clear message like `"OPENAI_API_KEY is not set. Add it to your environment."`.

---

### C-4: `countIssuesInCritique` returns 1 for non-empty unstructured text

**File**: [src/commands/review.mjs](src/commands/review.mjs#L86-L88)

```js
if (bulletLines.length > 0) return bulletLines.length
return 1  // fallback for any non-empty, non-"no issues" text
```

If a critique contains no bullet points but is non-empty (e.g., a paragraph response, an error message, a disclaimer), the issue count is reported as `1`. This inflates the reported issue count in log output and any downstream consumers of the report summary.

---

## 🟡 Major Issues

### M-1: Test case extraction regex is fragile

**File**: [src/capture/flow-onboarding.mjs](src/capture/flow-onboarding.mjs)

`extractTestCasesFromSource()` uses regex to parse Playwright test names. This breaks for:
- Multi-line `test(` definitions
- Template literal test names `` test(`${name} flow`, ...) ``
- Tests with comments inside the definition
- `test.describe` / `test.step` nesting
- Tests using `test.only` or `test.skip`

Affected command: `uxl flows import-playwright`. Users with complex test files will get incomplete or incorrect flow suggestions.

---

### M-2: Git worktree not cleaned up on implementation failure

**File**: [src/git/target-resolver.mjs](src/git/target-resolver.mjs)

When `target: "worktree"` is set and a worktree is created, any subsequent failure in `runImplement()` leaves the worktree and branch dangling. No cleanup handler is registered. The user must manually run `git worktree remove` and `git branch -D` to recover.

---

### M-3: `flows map` overwrites existing mappings without confirmation

**File**: [src/commands/flows.mjs](src/commands/flows.mjs)

Running `uxl flows map` overwrites existing flow mappings silently. There is no confirmation prompt or `--force` flag pattern. Users who accidentally run this command lose their existing mappings with no undo.

---

### M-4: `loadRawConfig` has no error handling for import failure

**File**: [src/config/config-file.mjs](src/config/config-file.mjs)

```js
export async function loadRawConfig(cwd) {
  const configPath = getConfigPath(cwd)
  const url = pathToFileURL(configPath).href + `?v=${Date.now()}`
  const mod = await import(url)  // no try/catch
  ...
}
```

A syntax error in the user's `uxl.config.mjs` will throw an unhandled `SyntaxError` or `TypeError` with no message indicating which file failed or how to fix it. The error will propagate unformatted to the terminal.

---

### M-5: `resolveReportInputPath` logic is confusing and has an edge case

**File**: [src/commands/implement.mjs](src/commands/implement.mjs#L50-L69)

When `reportPath` exists AND is named `report.md`, the function still looks for a newer timestamped report and falls back to the original if none found. This means a fresh `report.md` may be silently overridden by an older timestamped file if one exists in the same directory from a prior run. The logic should prefer the file that actually exists over a discovery fallback.

---

### M-6: Progress animation leaves terminal in unknown state on error

**File**: [src/commands/review.mjs](src/commands/review.mjs#L202-L204)

```js
} catch (error) {
  progress.stop(`Review failed for group ...`)
  throw error
}
```

`progress.stop()` writes `\r<message>\n` to stdout. If the terminal isn't in TTY mode, `stop()` is a no-op (correct). But on TTY, if `error` is rethrown and the parent has its own logging, the `\r` written by `stop()` may corrupt the next line. The spinner clears the line but the newline flush behavior depends on terminal buffering.

---

### M-7: No integration tests

The test suite covers unit-level validation, config schema, and mocked subprocess calls. There are no integration tests that exercise the full pipeline (`shots → review → implement`) even with mocked runners. Regressions in command wiring or config propagation would not be caught.

---

## 🔵 Minor Issues

### m-1: `REASONING_EFFORT_VALUES` is duplicated across two command files

**Files**: [src/commands/review.mjs:10](src/commands/review.mjs#L10), [src/commands/implement.mjs:10](src/commands/implement.mjs#L10)

The same constant and validation function `validateReasoningEffort()` are independently defined in both files. If a new value (e.g., `"ultraHigh"`) is added, it must be updated in multiple places. Should be extracted to a shared utility.

---

### m-2: `appendFileSync` called per log line in a hot loop

**File**: [src/utils/command-logger.mjs](src/utils/command-logger.mjs#L53)

Each call to `logger.log()` calls `fs.appendFileSync()` for every line of the message. During a review loop over many screenshot groups, this generates many synchronous file I/O calls. For large reviews this may be noticeably slow. Consider batching or using a write stream.

---

### m-3: Branch name timestamp contains colons on Windows

**File**: [src/git/target-resolver.mjs](src/git/target-resolver.mjs)

The default `branchNameTemplate` uses `{timestamp}`, which is derived from `new Date().toISOString()`. ISO timestamps contain colons (`:`) which are invalid in Windows branch names and certain shell contexts. The `sanitizeBranchName()` function does strip colons, but the template variable `{timestamp}` is not pre-sanitized before substitution, making the sanitization implicit and order-dependent.

---

### m-4: Loopback alias logic limited to three addresses

**File**: [src/capture/playwright-harness.mjs](src/capture/playwright-harness.mjs)

The server loopback alias detection only handles `localhost`, `127.0.0.1`, and `::1`. Apps binding to `0.0.0.0` or `127.0.0.2` (common in Docker or multi-service setups) will not have aliases built, potentially causing connectivity failures.

---

### m-5: `detail: "high"` is hardcoded in the OpenAI runner

**File**: [src/runners/review-openai.mjs](src/runners/review-openai.mjs)

The image detail level is hardcoded to `"high"` with no config option to change it. High detail significantly increases token usage and cost. Users on tight budgets or using low-res screenshots have no way to opt for `"low"` or `"auto"`.

---

### m-6: No log rotation or max log size

**File**: [src/utils/command-logger.mjs](src/utils/command-logger.mjs)

Log files accumulate indefinitely in `.uxl/logs/` with no rotation, retention policy, or size cap. Projects with frequent runs will accumulate large numbers of log files without any cleanup mechanism.

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
