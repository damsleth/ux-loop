## 2026-03-05

- C-1: Documented as not applicable. `reasoningEffort` is a Codex-only tuning knob and is intentionally not passed to the Copilot implement runner.
- C-2: Updated implement runners to return subprocess results (`runCodexImplement`, `runCopilotImplement`) while preserving throw-on-nonzero behavior.
- C-3: Added early OpenAI API key validation with a clear actionable error (`OPENAI_API_KEY is not set...`) before SDK calls.
