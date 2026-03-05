## 2026-03-05

- C-1: Documented as not applicable. `reasoningEffort` is a Codex-only tuning knob and is intentionally not passed to the Copilot implement runner.
- C-2: Updated implement runners to return subprocess results (`runCodexImplement`, `runCopilotImplement`) while preserving throw-on-nonzero behavior.
- C-3: Added early OpenAI API key validation with a clear actionable error (`OPENAI_API_KEY is not set...`) before SDK calls.
- C-4: Changed critique issue counting fallback from `1` to `0` for non-bulleted/unstructured text, with new unit tests for bullet/no-issue/unstructured cases.
