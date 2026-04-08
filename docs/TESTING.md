# Testing

The test strategy has three tiers.

## Unit tests

Fast deterministic tests cover:
- config normalization
- flow coverage logic
- prompt builders
- scoring
- CLI argument parsing
- git target resolution

Run:

```bash
npm test
```

## Golden tests

Golden fixtures live under `test/golden/`.

Each fixture set contains:
- a fixed critique input
- an expected severity breakdown
- an expected numeric score

These tests protect deterministic parsing and scoring behavior without requiring Playwright or LLM access.

## Deterministic flow tests

The static fixture app lives under `test/fixtures/test-app/`.

The Playwright-backed integration test:
- serves the fixture app locally
- runs the capture harness against it
- asserts that a screenshot file is produced and non-empty

If Playwright is not installed in the local environment, the integration test skips cleanly.

## Regression harness

The regression harness uses mocked review and implement steps to verify:
- pipeline exit state
- structured report shape
- stop-condition wiring

This keeps the end-to-end control flow covered without introducing live model or browser costs into the default test run.
