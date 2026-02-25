# Changelog

## 1.0.0 - 2026-02-25

- Initial release of `@damsleth/ux-loop`.
- Added CLI commands: `uxl init`, `uxl shots`, `uxl review`, `uxl implement`, `uxl run`.
- Added config contract via `uxl.config.mjs` and `defineUxlConfig`.
- Added generic Playwright capture harness with declarative `flows` and `devices`.
- Added Codex (default) and OpenAI review runners.
- Added Codex implementation runner with `current|branch|worktree` targets (default `worktree`).
- Added safety defaults (`autoCommit` forced false) and manifest/report generation.
- Added minimal Node test suite for config and harness validation.
