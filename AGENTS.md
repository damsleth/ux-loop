# AGENTS.md

## Purpose

This repository uses a review-driven improvement workflow. Agents should turn concrete review findings into tracked implementation work, execute that work cleanly, and leave the repo in a verifiable state.

## Core Workflow

### 1. Turn findings into plans

When a review produces actionable findings:

- Create one markdown plan per finding in `.plans/`.
- Use a stable, sortable filename such as:
  - `.plans/01-fix-short-slug.md`
  - `.plans/02-fix-another-slug.md`
- Each plan should be narrowly scoped to one finding.
- Each plan should explain:
  - the problem
  - the intended outcome
  - the proposed fix
  - implementation notes or constraints
  - the test plan
  - exit criteria

### 2. Track work in `TODO.md`

- Add one corresponding checkbox item to `.plans/TODO.md` for each plan.
- `.plans/TODO.md` is the authoritative task list.
- Each todo should link to its plan file in `.plans/`.
- Keep todo items concrete and implementation-oriented.
- Keep the todo tracker alongside the plans in `.plans/`, not at the repo root.

### 3. Execute one plan cleanly

When working a todo item:

- Read the linked plan first.
- Keep changes scoped to that plan unless a small adjacent fix is required for correctness.
- Update tests and documentation when behavior changes.
- Run the relevant verification for the touched area before considering the task done.

### 4. Close completed work

When a planned improvement is complete:

- Remove its item from `.plans/TODO.md`.
- Move the plan file from `.plans/` to `.plans/done/`.
- Commit the code after the implementation is verified.

If the work is only partially complete:

- Keep the todo item.
- Keep the plan in `.plans/`.
- Update the plan with the current state, blockers, or narrowed next steps.

## Planning Rules

- Do not combine multiple unrelated findings into one plan.
- Prefer small plans that can be completed and verified in one pass.
- If a finding requires follow-up work, create a new plan rather than overloading the original one.
- Preserve the original problem statement clearly enough that someone can implement from the plan without re-reading the full review.

## Implementation Expectations

- Inspect the existing code before editing.
- Do not revert unrelated user changes.
- Prefer minimal, targeted patches over broad refactors.
- Maintain existing project style unless there is a clear reason to improve it.
- Add tests for regressions whenever practical.
- If a bug is caused by missing validation, fix both the behavior and the regression coverage.

## Verification Expectations

- Run the narrowest useful validation first, then broaden if needed.
- For Node CLI changes, prefer targeted `node --test` runs when possible, then run broader suite coverage if the change is cross-cutting.
- If you cannot run verification, state that explicitly in the final handoff.

## File and Tracking Conventions

- Active plans live in `.plans/`.
- Completed plans live in `.plans/done/`.
- `.plans/` is local-only planning state and should not be committed unless the user explicitly asks for that.
- The active todo tracker lives at `.plans/TODO.md`.
- Do not treat a repo-root `TODO.md` as the source of truth for this workflow.
- Do not leave completed items in `.plans/TODO.md`.
- Do not leave completed plans in `.plans/`.

## Commit Expectations

- Commit after completing and verifying a plan.
- Keep commit messages specific to the completed improvement.
- Do not bundle multiple finished plans into one commit unless the work is tightly coupled.
- When pushing a meaningful user-visible or behavior-changing update, increment the package version.
- Default to a patch bump unless the user specifies a different version change.
- Update `CHANGELOG.md` for any meaningful change before pushing or handing off the work.

## Communication

- When starting work, identify which todo and plan you are executing.
- When finishing work, report:
  - what changed
  - what verification ran
  - whether the todo was removed
  - whether the plan was moved to `.plans/done/`
  - the resulting commit, if one was created

## Safety Rules

- Never use destructive git commands unless explicitly requested.
- Treat the worktree as potentially dirty.
- If you encounter unrelated changes in files you need to modify, stop and assess rather than overwriting them blindly.
