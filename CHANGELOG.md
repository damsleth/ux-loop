# Changelog

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
