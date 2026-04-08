

# Contributing

Keep it simple. This is a CLI tool, not a framework.

---

## Philosophy

- CLI-first
- minimal abstraction
- predictable behavior > cleverness
- no magic side effects

If something feels “smart”, it’s probably wrong.

---

## Setup

```bash
git clone https://github.com/damsleth/ux-loop
cd ux-loop
npm install
```

Run tests:

```bash
npm test
```

---

## Development workflow

1. Create a branch
2. Make changes
3. Test locally
4. Open PR

Keep PRs small and focused.

---

## Code style

- explicit over implicit
- no hidden mutations
- log important steps
- fail loudly with useful errors

---

## Areas that matter

High priority:

- flow system (capture + mapping)
- Playwright stability and determinism
- LLM prompt quality
- diff safety (never break user code silently)

---

## Before opening a PR

Make sure:

- `uxl run` still works end-to-end
- no breaking config changes
- logs are readable
- errors are actionable

---

## Releases

Private scoped package.

### Checklist

1. Bump version:

```bash
npm version patch
```

(or `minor` / `major`)

2. Validate:

```bash
npm test
npm pack --dry-run
```

3. Publish:

```bash
npm publish
```

Access is restricted via:

```json
"publishConfig": {
  "access": "restricted"
}
```

---

## Verify publish

```bash
npm view @damsleth/ux-loop version
```

---

## Reporting issues

Open an issue with:

- what you ran
- expected result
- actual result
- logs from `.uxl/logs`

---

## What NOT to contribute

- UI dashboards
- unnecessary abstractions
- “framework” features

This stays a tool.

---

## Questions

Open an issue or ping.