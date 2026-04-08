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