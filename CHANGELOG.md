# Changelog

## 1.1.6 - 2026-04-22

- Extended `uxl run` implement gating so implement is also skipped when `runShots=true` fails but `runReview=false`; the failing prerequisite now always short-circuits implement.
- Stopped the capture dev server when `chromium.launch` throws; the launch call now runs inside the cleanup `try/finally` so a browser launch failure can no longer orphan the spawned server. `runBrowserCleanup` also tolerates a null browser.
- Detected screenshot filename collisions where different raw flow or device names sanitize to the same artifact path; capture now throws a clear duplicate-artifact error instead of silently overwriting shots.
- Detected `PORT=...` env assignments in imported Playwright `webServer.command` strings and used them for `capture.baseUrl` when no explicit `baseURL` is present. When no port can be detected anywhere, init now keeps the framework default (5173) instead of inventing a derived port the preserved command cannot honor, and logs the chosen port source (`playwright-baseurl`, `webserver-args`, `webserver-env`, `framework-default`, or `derived-fallback`).
- Added a capture server identity fingerprint: new `capture.expectTitleIncludes` config option, verified via `verifyServerIdentity` against the live HTML `<title>` immediately after server readiness on both spawned and reused paths. `uxl init` scaffolds the default from `package.json` (scope stripped) and failures surface the expected/actual titles plus an `lsof -iTCP:<port> -sTCP:LISTEN` hint.
- **Breaking default**: `capture.playwright.reuseExistingServer` now defaults to `false`. `uxl shots` refuses to reuse a server already bound to `baseUrl` and instead fails fast with an `lsof` hint. Users who intentionally manage an external dev server must set `reuseExistingServer: true` and take responsibility for the identity check.

## 1.1.5 - 2026-04-19

- Piped Copilot runner prompts via stdin instead of `--prompt` argv, avoiding OS argument-size limits and preventing prompt content from leaking into process listings.
- Gated `uxl run` downstream stages on upstream success so `review` and `implement` are recorded as `skipped` (not silently re-run against stale artifacts) when a prerequisite step fails with `stopOnError=false`.
- Wrote the canonical `.uxl/report.md` alongside the timestamped review output so the default review-to-implement handoff cannot be shadowed by an older `report.md`.
- Hardened Playwright capture cleanup so a throwing `browser.close()` no longer orphans the dev server; both cleanups now run best-effort with clear warnings.
- Surfaced dev-server spawn errors and early exits immediately in `ensureServer` instead of stalling through the full readiness timeout with a generic error.
- Sanitized capture screenshot filenames so flow or device names containing path separators or traversal segments can no longer write outside `shotsDir`.
- Parsed env-prefixed Playwright `webServer.command` strings (`HOST=127.0.0.1 npm run dev`) during `uxl init`, preserving leading `KEY=value` pairs and passing them through at capture-time spawn.
- Honored `runtime.cleanupTarget` injection in `runRollback` worktree path for symmetry with the branch/current paths and testability.

## 1.1.4 - 2026-04-19

- Fixed `paths.root` normalization so relative roots resolve from the config file directory instead of the invocation cwd, and hardened config merging to avoid shared nested defaults.
- Fixed `uxl rollback` for `current` snapshots to require a clean working tree before `git reset --hard`, and removed the stale `stashRef` rollback path.
- Fixed branch-target failure cleanup so failed `uxl implement --target branch` runs restore the original branch and delete disposable generated branches.
- Fixed `uxl diff` cleanup so worktree cleanup warnings no longer mask the primary runner failure.

## 1.1.3 - 2026-04-19

- Simplified implement safety around the clean-worktree assumption: `current` and `branch` targets now fail fast on dirty repos instead of using stash-based carry-over.
- Fixed implement diff stats and scope validation to include newly created files, and ensured `uxl diff` captures added files in generated patches.
- Fixed `uxl apply --commit` to stage deletion patches correctly with `git add -A`.
- Added regression coverage for clean-worktree enforcement, untracked-file scope validation, diff-only patch generation, and apply commit behavior.

## 1.1.2 - 2026-04-08

- Added scoped implement modes via `--scope` / `implement.scope`, plus diff-based scope validation for safer code edits.
- Added structured review severity markers, deterministic scoring, style presets, prompt-file overrides, and prompt token guardrails.
- Added iterative `uxl run` control with score-based stop conditions, explicit pipeline states, and structured JSON reports.
- Added git safety features including current-branch confirmation, dirty-worktree handling, `--dry-run`, diff-first patch generation, rollback snapshots, and `uxl diff|apply|rollback|report`.
- Improved Playwright reliability with action retries, timeout overrides, screenshot stabilization, viewport clamping, selector validation via `uxl flows validate`, and screenshot/resource limits.
- Added architecture/testing docs, golden scoring fixtures, a static test app, a regression harness test, and broader prompt/scope coverage.

## 1.1.1 - 2026-04-08

- Added CLI argument parsing and timeout support for `uxl review` and `uxl implement`.
- Added configurable OpenAI image detail handling for visual reviews.
- Improved capture server readiness detection with broader loopback alias probing.
- Fixed custom capture runner coverage gating so non-Playwright adapters can pass the required-flow checks.
- Fixed invalid `uxl implement --target` values to fail safely instead of falling through into worktree creation.
- Fixed route discovery during onboarding to cover common Next.js layouts, including `pages/` and `src/app/`.
- Fixed `uxl flows map` so empty mapping targets are rejected instead of writing invalid config.
- Fixed Codex review path handling for screenshot filenames that contain commas.
- Improved implement failure handling and worktree cleanup behavior.
- Improved review/report handling with better report path precedence and critique issue counting.
- Improved config loading and init behavior, including clearer config import errors, safer interactive prompt timeouts, and more robust command tokenization.
- Improved Playwright test extraction and capture progress terminal cleanup.
- Improved command logging with shared reasoning-effort validation, sync write batching, and log rotation retention.
- Expanded automated coverage across CLI routing, flow commands, pipeline behavior, OpenAI review, report resolution, init helpers, stateful Playwright actions, and the backlog bug-fix regressions.
- Added repository workflow documentation in `AGENTS.md` covering local-only `.plans/`, `.plans/TODO.md`, version bump expectations, and changelog maintenance.

## 1.1.0 - 2026-02-25

- Added strict full-flow coverage gate for `uxl shots` and `uxl run`.
- Added explicit flow data contract: `capture.flowInventory`, `capture.flowMapping`, and `capture.onboarding.status`.
- Added `uxl flows` command group (`list`, `add`, `map`, `check`, `import-playwright`).
- Updated `uxl init` with first-run onboarding scaffold, interactive confirmation, and non-interactive mode.
- Added Playwright test import helpers for flow suggestion generation.
- Expanded test suite for schema, onboarding coverage, init behavior, flow commands, and shots gating.

## 1.0.0 - 2026-02-25

- Initial release of `@damsleth/ux-loop`.
- Added CLI commands: `uxl init`, `uxl shots`, `uxl review`, `uxl implement`, `uxl run`.
- Added config contract via `uxl.config.mjs` and `defineUxlConfig`.
- Added generic Playwright capture harness with declarative `flows` and `devices`.
- Added Codex (default) and OpenAI review runners.
- Added Codex implementation runner with `current|branch|worktree` targets (default `worktree`).
- Added safety defaults (`autoCommit` forced false) and manifest/report generation.
- Added minimal Node test suite for config and harness validation.
