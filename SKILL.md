---
name: negplan
description: Make the agent earn every line of code it writes. Before implementing a build request, draft a will-not-implement ledger (.negplan.md), surface every scope item it refuses to do for a human y/n override, then only propose diffs whose hunks each cite a will_implement entry. Use whenever the user asks you to "build", "implement", or "add" a feature and wants the scope fight to happen before code is written, not after.
---

# NegPlan — the will-not-implement ledger protocol

NegPlan moves the scope fight **upstream of code generation**. The plan opens
not as a to-do list but as an explicit *will-not-implement* ledger: the scope
items the agent considered but refuses to do, each with a one-line
justification. Only then does the agent propose code, and every diff hunk must
cite a `will_implement` entry it satisfies. Hunks with no entry are flagged as
scope creep and held at the gate until the human overrides them.

The ledger is a portable markdown file (`.negplan.md`). It is both the plan
and the audit log — it survives across agents precisely because it is plain
markdown, not a platform API.

## When to use this skill

Use NegPlan whenever the user asks you to **build / implement / add** a feature
**using negplan** (or whenever they ask for scope discipline on a build task).
Do not use it for a one-line fix, a pure question, or a refactor the user
already scoped tightly.

## The ledger format

`.negplan.md` has YAML frontmatter and three markdown tables:

```markdown
---
task: "Build the login page"
agent: claude-code
created_at: 2026-08-28T10:00:00Z
status: drafting
---

## will_implement

| id | summary | rationale |
| --- | --- | --- |
| w1 | Add POST /login route | Core requirement of this task |

## will_not_implement

| id | summary | rationale | overridden |
| --- | --- | --- | --- |
| n1 | OAuth/SSO providers | Out of scope for v0.1; plain session only | false |

## gates

| change_id | file | hunk | entry_id | verdict | human_override |
| --- | --- | --- | --- | --- | --- |
```

- `will_implement` — scope you are **allowed** to write code for. Each later
  diff hunk must cite one entry by `id` (e.g. `w1`).
- `will_not_implement` — scope you considered and **refuse** to do, each with a
  one-line `rationale`. The human may override a veto (`overridden: true`),
  which moves the item into `will_implement`.
- `gates` — the audit log of every diff hunk the gate saw and its verdict
  (`allowed` / `creep` / `overridden`). The m1 release defines the ledger; gate
  enforcement appends rows here (milestone m2).

## The protocol (in order)

### 1. Open the ledger

If no `.negplan.md` exists in the repo, create one:

```bash
npx negplan init --task "<the task the user just asked for>"
```

This writes a fresh, valid (empty) ledger with `status: drafting`. If one
already exists for this task, read it and continue from where it left off.

### 2. Draft both lists before writing any code

Think about the whole task, then fill **both** tables in one pass:

- `will_implement`: the smallest set of items that delivers the task.
- `will_not_implement`: everything you considered but are refusing —
  speculative infrastructure, adjacent refactors, "while I'm here" features,
  premature abstractions. **This list is the point of the product.** Each row
  gets a one-line `rationale`.

Be honest and specific. "won't add a cache layer — the task has no read
load" is a good veto. "won't do unrelated stuff" is not. A sparse
will_not_implement list means you haven't actually thought about what to cut.

### 3. Surface the vetoes and ask for overrides

Print the ledger to the user (both tables) and ask, per `will_not_implement`
item:

> I will not do the following. Override any veto? Answer y/n per item:
> - n1 OAuth/SSO providers — out of scope for v0.1
> - n2 Password reset email flow — defer to next sprint
> ...

For each `y`, set `overridden: true` in the ledger and move the item's intent
into `will_implement`. Set `status: negotiating` while this is open. Do **not**
propose code until the user has answered (or explicitly said "none").

### 4. Propose diffs that each cite an entry

When you propose a diff, every hunk must correspond to a `will_implement`
entry. State the entry id next to each hunk you propose, e.g. "hunk for
`src/routes/login.ts` — satisfies `w1`". A hunk that touches something with no
matching entry is scope creep — do not write it; surface it as a new candidate
veto instead.

### 5. Render the summary

When done, summarize what was allowed vs held:

```bash
npx negplan render
```

> Note: the m1 release ships `init` + `validate` fully. `gate` (hunk-level
> enforcement against the ledger, milestone m2) and `render` (the readable
> veto/allow summary + override panel, milestone m3) land next — see the README
> roadmap. Until then, follow the protocol above in spirit: cite the entry each
> hunk satisfies, and hold hunks with no entry rather than writing them.

## Always validate before finishing

```bash
npx negplan validate
```

Must exit green. A red validate means the ledger is malformed — fix it before
proposing code. Common failures: an `id` not matching `w<n>` / `n<n>` /
`g<n>`, a `status` outside `drafting | negotiating | gating | done`, or an
unknown frontmatter key.

## What this skill is not

- It is **not** a "be lazy" persona prompt. It is a machine-checkable contract:
  the ledger is a file the human can audit and reverse, not a vibe shift.
- It is **not** post-hoc logging. The ledger is drafted **before** code, so the
  scope negotiation happens upstream of `git diff`, not as a pruning session
  afterward.
- It does **not** gate at the AST level. v0.1 gates at the line/hunk level — a
  hunk's file path and cited entry are the unit of enforcement.
