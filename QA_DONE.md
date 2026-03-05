## 2026-03-05

- C-1: Documented as not applicable. `reasoningEffort` is a Codex-only tuning knob and is intentionally not passed to the Copilot implement runner.
- C-2: Updated implement runners to return subprocess results (`runCodexImplement`, `runCopilotImplement`) while preserving throw-on-nonzero behavior.
- C-3: Added early OpenAI API key validation with a clear actionable error (`OPENAI_API_KEY is not set...`) before SDK calls.
- C-4: Changed critique issue counting fallback from `1` to `0` for non-bulleted/unstructured text, with new unit tests for bullet/no-issue/unstructured cases.
- M-4: Wrapped `loadRawConfig` dynamic import failures with a user-friendly message that includes the failing `uxl.config.mjs` path.
- M-5: Changed `resolveReportInputPath` to prefer an existing explicit `report.md`, and only discover timestamped reports when `report.md` is missing (with direct tests).
- M-3: Added overwrite safety for `uxl flows map`: interactive confirmation by default and explicit `--force` override for non-interactive usage.
- M-2: Added best-effort cleanup for failed worktree implementations (`git worktree remove --force` + `git branch -D`) to avoid dangling branches/worktrees.
- M-1: Reworked Playwright test extraction to handle multiline `test(...)` calls, `test.only/skip/fixme`, and template-literal titles more robustly.
- M-6: Updated review spinner stop behavior to clear the active line before printing final status, preventing carriage-return artifacts.
- M-7: Added pipeline integration-style tests for step sequencing and `stopOnError` behavior, with dependency injection support in `runPipeline`.
- m-1: Extracted reasoning effort values/validation into `src/utils/reasoning-effort.mjs` and reused it in both `review` and `implement` commands.
- m-2: Reduced hot-loop logger I/O by batching each log call to a single `appendFileSync` write while preserving per-line timestamps.
- m-6: Added per-scope log rotation in `.uxl/logs` to keep the latest 50 log files.
- m-3: Verified as already satisfied: `{timestamp}` in branch templating is pre-sanitized via `toISOString().replace(/[:.]/g, "-")`.
