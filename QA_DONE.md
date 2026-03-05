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
