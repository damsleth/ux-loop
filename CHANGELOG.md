# Changelog

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
