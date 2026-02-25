# @damsleth/ux-loop

Generic CLI-first UX pipeline for npm projects:

- `shots` (capture screenshots)
- `review` (visual critique)
- `implement` (apply changes with Codex)
- `run` (all three in sequence)

## Install

```bash
npm i -D @damsleth/ux-loop
```

Optional (only if using `uxl review --runner openai`):

```bash
npm i -D openai
```

## Scripts

```json
{
  "scripts": {
    "uxl:shots": "uxl shots",
    "uxl:review": "uxl review",
    "uxl:implement": "uxl implement",
    "uxl:run": "uxl run"
  }
}
```

## Minimal config (no adapter file required)

Create `uxl.config.mjs`:

```js
import { defineUxlConfig } from "@damsleth/ux-loop"

export default defineUxlConfig({
  capture: {
    runner: "playwright",
    baseUrl: process.env.UI_REVIEW_BASE_URL || "http://127.0.0.1:5173",
    timeoutMs: 120000,
    playwright: {
      startCommand: "dev",
      devices: [
        { name: "mobile", width: 390, height: 844 },
        { name: "desktop", width: 1280, height: 800 },
      ],
      flows: [
        {
          label: "Home — Mobile vs Desktop",
          name: "home",
          path: "/",
          waitFor: "main",
          settleMs: 250,
          screenshot: { fullPage: true },
        },
      ],
    },
  },
  review: {
    runner: "codex",
  },
  implement: {
    target: "worktree",
  },
})
```

## Capture differentiators

The harness keeps mechanics generic and stable. Per-project variation lives in:

- **Flows**: navigation + interactions + screenshot targets.
- **Devices**: viewport or Playwright device presets.

## Flow action types

- `goto`
- `waitForSelector`
- `click`
- `press`
- `fill`
- `check`
- `uncheck`
- `wait`
- `storeFirstLink`
- `storeFirstLinkWithSelector`
- `gotoStored`
- `toggleUntilAttribute`

## Optional custom adapter mode

If needed, set:

- `capture.runner = "custom"`
- `capture.adapter = "./uxl.capture.mjs"`

Adapter exports:

```js
export async function captureUx(context) {
  return [{ label: "...", files: ["..."] }]
}
```

## Command summary

- `uxl init`
- `uxl shots`
- `uxl review`
- `uxl implement`
- `uxl run`

## Release

Private scoped publish checklist:

1. Log in to npm with an account that has access to the `@damsleth` scope.
2. Ensure package version is bumped in `package.json`.
3. Run validation:

```bash
npm run release:check
```

Equivalent explicit commands:

```bash
npm test
npm pack --dry-run
```

4. Publish as private scoped package (access is already set via `publishConfig.access = "restricted"`):

```bash
npm publish
```

Optional verification:

```bash
npm view @damsleth/ux-loop version
```
