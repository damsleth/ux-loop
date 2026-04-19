# Architecture

`ux-loop` is organized around three engines with deliberately narrow contracts.

## Capture

Input:
- normalized config
- flow inventory and flow mapping
- capture adapter or Playwright flow definitions

Output:
- screenshots under `.uxl/shots/`
- manifest at `.uxl/shots/manifest.json`

Rules:
- no git mutations
- no code changes
- only artifact writes under `.uxl/`

## Review

Input:
- manifest
- screenshots referenced by the manifest
- review prompt, style preset, and model settings

Output:
- markdown critique report
- deterministic severity counts and numeric score
- structured JSON report under `.uxl/reports/`

Rules:
- no git mutations
- no source-tree writes outside `.uxl/`
- image interpretation only goes through manifest groups

## Implement

Input:
- review report
- implement prompt, style preset, scope, and target settings

Output:
- code changes in the selected target
- optional patch artifact under `.uxl/diffs/`
- rollback snapshot metadata under `.uxl/snapshots/`
- structured JSON report under `.uxl/reports/`

Rules:
- git operations are allowed here only
- mutable commands assume a clean working tree unless the target is an isolated worktree
- source mutations must stay within the selected target
- scope validation runs against the produced diff, including newly created files, before optional auto-commit

## Pipeline

`uxl run` composes the engines as:

1. `shots`
2. `review`
3. `implement`

The pipeline can iterate, but the engine contracts stay the same on every round. Structured reports aggregate step timing, issue counts, score movement, and implement diff stats so runs remain comparable.
