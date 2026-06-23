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
    expectTitleIncludes: "my-app",
    flowInventory: [
      { id: "home", path: "/", required: true },
    ],
    flowMapping: {
      home: ["home"],
    },
    playwright: {
      // default: false. ux-loop always starts its own dev server and fails
      // fast if the port is already bound. Set to true only if you manage
      // the server externally (CI, remote host) and accept responsibility
      // for expectTitleIncludes matching the running app.
      reuseExistingServer: false,
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
- mutating commands assume a clean git working tree
- no auto-commit unless enabled
- you review diffs before merging

You stay in control.

If you choose `--target current` or `--target branch`, start from a clean working tree. `uxl implement` and `uxl apply` fail fast when unrelated local changes are present.

---

## Runners

| Runner | Review | Implement | Auth |
|---|:---:|:---:|---|
| `codex` (default) | ✅ | ✅ | codex CLI login |
| `copilot` | ✅ | ✅ | copilot CLI login |
| `claude` | ✅ | ✅ | `claude` CLI subscription locally; `ANTHROPIC_API_KEY` for headless/CI |
| `openai` | ✅ | — | `OPENAI_API_KEY` (requires `npm i openai`) |

Set the runner per phase in config (`review.runner`, `implement.runner`) or pass
`--runner <name>` to `uxl review` / `uxl run` (review phase). The `claude` runner
shells out to the installed `claude` CLI — no `@anthropic-ai/sdk` dependency, no
raw API calls. Review restricts the agent to its `Read` tool; implement allows
`Read,Edit,Write,Glob,Grep` (no `Bash`, enforcing file-only edits) under
`--permission-mode acceptEdits`.

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

## CI / GitHub Action

Run shots + review on every pull request and post the UX score as a sticky
comment with the in-repo composite action:

```yaml
name: UX review
on: pull_request
permissions:
  contents: read
  pull-requests: write   # required for the sticky comment
jobs:
  uxl:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: damsleth/ux-loop@v1
        with:
          fail-under: 70
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

The action runs `uxl shots` then `uxl review` and **never implements** — CI must
not mutate code. It posts/updates one sticky comment (anchored on a hidden
`<!-- uxl-report -->` marker), uploads `.uxl/shots` + `.uxl/reports` as
artifacts, and optionally fails the check via `fail-under`.

| input | default | notes |
|---|---|---|
| `working-directory` | `.` | where the target app lives (`uxl.config.mjs` is resolved here) |
| `runner` | `claude` | passed as `--runner` |
| `model` | `` | passed as `--model` when set |
| `fail-under` | `0` | `0` = report-only; otherwise fail when the blended score is below `N` |
| `comment` | `true` | post/update the sticky PR comment |
| `node-version` | `22` | engines require >= 22 |

Auth (set as job `env`, not inputs): `ANTHROPIC_API_KEY` for the `claude` runner
(the documented default), `OPENAI_API_KEY` for `openai`. The action preflights
the selected runner's credential and fails fast with a clear message if it's
missing. The action resolves via git tags — pin `@v1` (a moving major tag
maintained on releases). A ready-to-copy workflow lives at
[`examples/uxl-pr-review.yml`](examples/uxl-pr-review.yml).

`uxl report --format github` (used by the action) prints the same sticky-comment
markdown to stdout locally; `--fail-under <1-100>` exits with code `2` when the
latest report's score is below the threshold.

---

## Convergence loop & keep-best

`uxl run` iterates shots → review → implement up to `run.maxIterations`, stopping
when the score meets `run.scoreThreshold`, no issues remain, or a score fails to
improve over the previous iteration.

Because an implement step can occasionally make the UI *worse*, the loop keeps a
**best-iteration acceptance gate** (`run.keepBest`, default `true`): when the run
ends below its best observed iteration, the working tree is restored to that best
iteration's state. A regressing multi-iteration run can therefore never end worse
than its best point. The JSON report records `kept_iteration`, `best_score`, and
`restored` (`true` / `false` / `"skipped"` / `"failed"`).

- Disable per-run with `uxl run --no-keep-best`, or globally with `run.keepBest: false`.
- No-op for review-only runs, single-iteration runs, and `worktree` implement
  targets (whose iterations don't compound). If the restore itself fails, the run
  still reports and prints a manual `uxl rollback --yes --to <timestamp>` hint.

---

## Objective scoring

Starting with v1.2.0, `uxl shots` injects lightweight probes into the captured pages to produce *objective metrics* alongside the LLM critique. `uxl review` then blends both signals into a composite score (0–100).

### Score sources

| source | when it applies |
|--------|-----------------|
| `blended` | manifest has per-group `metrics` **and** LLM prose is available |
| `review-prose` | no metrics in manifest (default before v1.2.0 / metrics disabled) |
| `objective` | metrics present but review disabled |

Console output example:
```
Review complete. Review score: 78/100 (blended: objective 82, prose 72).
```

### What the probes collect

**axe-core** (optional, requires `axe-core` installed as a dev dependency):
- accessibility violation counts by impact: `critical`, `serious`, `moderate`, `minor`

**Heuristics** (always active):
- `viewportMeta` — whether `<meta name="viewport">` is present
- `smallTapTargets` — interactive elements with bounding box < 44×44 px
- `lowContrastSamples` — text elements with computed contrast ratio < 3:1
- `fontSizeCount` — number of distinct font sizes in use

### Configuration

```js
export default defineUxlConfig({
  capture: {
    // Set to false to disable all metric probes entirely.
    // Default: true
    metrics: true,
  },
  run: {
    // Override the blend weights (must sum to ≤ 1; defaults are objective: 0.6, review: 0.4).
    // Not a CLI flag — config only.
    scoreWeights: { objective: 0.6, review: 0.4 },
  },
})
```

### axe-core — optional peer dependency

axe-core is declared as an optional peer dependency. If it is not installed, uxl emits a single `warn` per capture run and continues without accessibility metrics.

To enable it:
```bash
npm i -D axe-core
```

### Graceful degradation

All of the following behave identically to v1.1.x (score source is `review-prose`):
- `axe-core` is not installed
- `capture.metrics: false` is set in config
- The page crashes during the metrics probe

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
