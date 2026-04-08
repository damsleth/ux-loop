# @damsleth/ux-loop

Generic CLI-first UX pipeline for npm projects:

- `shots` (capture screenshots)
- `review` (visual critique)
- `implement` (apply changes with Codex or Copilot)
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

`uxl` loads workspace `.env` and `.env.local` files before importing `uxl.config.mjs`. Existing shell env vars still win.

Optional (only if using `review.runner = "copilot"` or `implement.runner = "copilot"`):

- Install GitHub Copilot CLI and make sure `copilot` is on `PATH`.

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
If a `playwright.config.*` file already exists, `uxl init` reads it and reuses detected `baseURL` and `webServer.command`.

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
    runner: "codex", // codex | copilot | openai
    reasoningEffort: "medium", // low | medium | high | extraHigh
    timeoutMs: 600000,
  },
  implement: {
    runner: "codex", // codex | copilot
    reasoningEffort: "medium", // low | medium | high | extraHigh
    target: "worktree",
    autoCommit: false,
    timeoutMs: 900000,
  },
  output: {
    verbose: false,
  },
})
```

`output.verbose` controls whether full runner logs are echoed to the terminal. Logs are always written under `.uxl/logs`.

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
- `uxl review [--reasoning-effort low|medium|high|extraHigh]`
- `uxl implement [--reasoning-effort low|medium|high|extraHigh]`
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

# ux-loop

Fix your UI from the terminal.

Take screenshots → get UX feedback → apply fixes automatically.

---

## Quick start

```bash
npm i -D @damsleth/ux-loop
npx uxl init
npx uxl run
```

That’s it.

---

## What happens

When you run:

```bash
uxl run
```

ux-loop will:

1. Open your app with Playwright
2. Capture screenshots (mobile + desktop)
3. Send them to an LLM for UX critique
4. Generate concrete improvements
5. Apply changes to your code (in a safe workspace)

### Output

- screenshots → `.uxl/shots`
- review logs → `.uxl/logs`
- code changes → git worktree or staged changes

---

## Example

Before:
- low contrast buttons
- cramped layout
- inconsistent spacing

ux-loop suggests:
- increase contrast on CTA
- add spacing between sections
- fix font hierarchy

Then applies:

```diff
-.btn { background: #ccc }
+.btn { background: #0a84ff; color: white }
```

---

## Core commands

Run everything:

```bash
uxl run
```

Or step-by-step:

```bash
uxl shots       # capture UI
uxl review      # analyze UX
uxl implement   # apply fixes
```

---

## Flow coverage (important)

ux-loop forces you to define all critical user flows before running.

No “forgot to test checkout” problems.

```bash
uxl flows check
```

All required flows must reach 100% coverage before screenshots run.

---

## Minimal config

```js
import { defineUxlConfig } from "@damsleth/ux-loop"

export default defineUxlConfig({
  capture: {
    baseUrl: "http://localhost:5173",
  },
})
```

---

## Full config (example)

```js
export default defineUxlConfig({
  capture: {
    runner: "playwright",
    baseUrl: "http://127.0.0.1:5173",
    flowInventory: [
      { id: "home", path: "/", required: true },
    ],
    flowMapping: {
      home: ["home"],
    },
  },
  review: {
    runner: "codex",
  },
  implement: {
    runner: "codex",
    target: "worktree",
    autoCommit: false,
  },
})
```

---

## Safety

ux-loop does **not** blindly edit your project.

- changes happen in a git worktree (default)
- no auto-commit unless enabled
- you review diffs before merging

You stay in control.

---

## Runners

Supported:

- `codex` (default)
- `copilot`
- `openai` (requires `npm i openai`)

---

## Flow actions (Playwright)

Used to describe user journeys:

- `goto`
- `click`
- `fill`
- `waitForSelector`
- `press`

---

## Who this is for

- frontend devs who hate manual UX QA
- solo builders shipping fast
- teams iterating on UI daily

---

## Not for

- pixel-perfect design systems
- fully automated production pipelines (yet)

---

## Commands

Setup:

```bash
uxl init
uxl flows check
```

Run:

```bash
uxl run
```

Advanced:

```bash
uxl review --reasoning-effort high
uxl implement --reasoning-effort high
```

---

## Logs

All logs are stored in:

```
.uxl/logs
```

Verbose mode:

```js
output: {
  verbose: true
}
```

---

## Contributing

See [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)