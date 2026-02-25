# @damsleth/ux-loop

Generic CLI-first UX pipeline for npm projects:

- `shots` (capture screenshots)
- `review` (visual critique)
- `implement` (apply changes with Codex)
- `run` (all three in sequence)

## Strict flow mapping (default)

`uxl shots` is gated until required flow inventory coverage is 100%.

Coverage means every `capture.flowInventory` entry with `required: true` must map to one or more valid `capture.playwright.flows[].name` values in `capture.flowMapping`.

## Install

```bash
npm i -D @damsleth/ux-loop
```

Optional (only if using `uxl review --runner openai`):

```bash
npm i openai
```

## Scripts

```json
{
  "scripts": {
    "uxl:init": "uxl init",
    "uxl:flows": "uxl flows check",
    "uxl:shots": "uxl shots",
    "uxl:review": "uxl review",
    "uxl:implement": "uxl implement",
    "uxl:run": "uxl run"
  }
}
```

## First run

```bash
uxl init
uxl flows check
```

Then complete mappings with `uxl flows add` and `uxl flows map` until coverage is 100%.
`uxl init` also scaffolds `uxl:*` scripts into `package.json` (without overwriting existing script entries).

`uxl` resolves the project workspace from the original invocation directory (for example `INIT_CWD` under `npm exec`) so config is written to your project root, not package install directories.

## Config shape

Create `uxl.config.mjs`:

```js
import { defineUxlConfig } from "@damsleth/ux-loop"

export default defineUxlConfig({
  capture: {
    runner: "playwright",
    baseUrl: process.env.UI_REVIEW_BASE_URL || "http://127.0.0.1:5173",
    timeoutMs: 120000,
    onboarding: {
      status: "pending",
    },
    flowInventory: [
      { id: "home", label: "Homepage", path: "/", required: true },
      { id: "pricing", label: "Pricing page", path: "/pricing", required: true },
    ],
    flowMapping: {
      home: ["home"],
      pricing: ["pricing"],
    },
    playwright: {
      startCommand: "dev",
      devices: [
        { name: "mobile", width: 390, height: 844 },
        { name: "desktop", width: 1280, height: 800 },
      ],
      flows: [
        {
          label: "Homepage",
          name: "home",
          path: "/",
          waitFor: "main",
          settleMs: 250,
          screenshot: { fullPage: true },
        },
        {
          label: "Pricing",
          name: "pricing",
          path: "/pricing",
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

## Flows command group

- `uxl flows list`
- `uxl flows add --id <id> --label <label> [--path <path>] [--to <flowName>]`
- `uxl flows map --id <inventoryId> --to <flowName[,flowName]>`
- `uxl flows check`
- `uxl flows import-playwright [--yes]`

`import-playwright` only adds suggestions and leaves onboarding pending.

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

- `uxl init [--preset=playwright-vite] [--force] [--non-interactive]`
- `uxl flows <list|add|map|check|import-playwright>`
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
