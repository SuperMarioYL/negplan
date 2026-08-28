<div align="right"><sub><b>EN</b>&nbsp;&nbsp;⇄&nbsp;&nbsp;<a href="./README.zh-CN.md">中文</a></sub></div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/hero-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/hero-light.svg">
  <img src="./assets/hero-light.svg" width="880" alt="NegPlan — the will-not-implement ledger for coding agents">
</picture>

<p align="center"><sub>NegPlan is the will-not-implement ledger that gates coding-agent scope creep for solo devs.</sub></p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license"></a>
  <a href="https://github.com/SuperMarioYL/negplan/releases"><img src="https://img.shields.io/github/v/release/SuperMarioYL/negplan" alt="release"></a>
  <a href="https://github.com/SuperMarioYL/negplan/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/SuperMarioYL/negplan/ci.yml?branch=main" alt="CI"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-339933" alt="node">
</p>

**Stop pruning your coding agent's speculative code by hand — make it declare a will-not-implement list first, then earn every line through a gate you can override.**

<h2><img src="https://api.iconify.design/tabler:topology-star-3.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Architecture</h2>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/atlas-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/atlas-light.svg">
  <img src="./assets/atlas-light.svg" width="880" alt="Architecture: the agent drafts the will-not-implement ledger, the gate checks each diff hunk against it, verdicts land in the gates audit log">
</picture>

The plan opens as a **will-not-implement** ledger (`.negplan.md`). The agent drafts both lists — what it *will* do and what it *refuses* to do — before writing code. Every diff hunk must then cite a `will_implement` entry; a hunk with no entry is held as scope creep until you override it. Two components, one process, no server: a portable [Claude Code skill](./SKILL.md) and a tiny Node CLI that reads and writes the same markdown file.

## Table of Contents

- [Why this exists](#why-this-exists)
- [Quickstart](#quickstart)
- [Usage](#usage)
- [Demo](#demo)
- [Roadmap](#roadmap)
- [License](#license)

<h2><img src="https://api.iconify.design/tabler:bulb.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Why this exists</h2>

Coding agents default to maximal scope: asked for feature X, they ship X plus speculative infrastructure, adjacent refactors, and "while I'm here" features — and today the code *compiles*, so pruning it is expensive. NegPlan moves the scope fight **upstream of code generation**: the plan opens as a machine-checkable will-not-implement ledger, and each diff hunk must cite an entry it satisfies or it is held at the gate. The ledger is plain markdown, so it survives across agents — not a platform API you get locked into.

<h2><img src="https://api.iconify.design/tabler:rocket.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Quickstart</h2>

Three commands from cold clone to a validated ledger:

```bash
git clone https://github.com/SuperMarioYL/negplan.git && cd negplan && npm install && npm run build
node dist/src/cli.js init --task "Add a login page"   # writes .negplan.md (the will-not-implement ledger)
node dist/src/cli.js validate                          # → "negplan: .negplan.md is valid."
```

Once published to npm, the first line becomes `npx negplan init --task "Add a login page"`.

<details><summary>sample output</summary>

```
$ node dist/src/cli.js init --task "Add a login page"
negplan: wrote .negplan.md (task: "Add a login page")
next: open it, then ask your agent to fill the will_implement + will_not_implement lists.

$ cat .negplan.md
---
task: "Add a login page"
agent: claude-code
created_at: "2026-08-28T10:00:00Z"
status: drafting
---

## will_implement
| id | summary | rationale |
| --- | --- | --- |

## will_not_implement
| id | summary | rationale | overridden |
| --- | --- | --- | --- |

## gates
| change_id | file | hunk | entry_id | verdict | human_override |
| --- | --- | --- | --- | --- | --- |

$ node dist/src/cli.js validate
negplan: .negplan.md is valid.
```
</details>

Then ask your agent: *"Build feature X using negplan."* The [skill](./SKILL.md) makes it fill both lists, surface the vetoes for a y/n override, and only then propose diffs whose hunks each cite an entry.

<h2><img src="https://api.iconify.design/tabler:terminal-2.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Usage</h2>

```bash
negplan init    [--task "<text>"] [--output <path>] [--force] [--agent <name>]   # write a fresh ledger
negplan validate [--file <path>]                                                 # validate against the ledger schema
negplan gate    [<file>]        # (m2) gate a diff's hunks against allowed entries
negplan render  [<file>]        # (m3) print a veto/allow summary + override panel
```

Draft a ledger for a real task:

```bash
negplan init --task "Add a login page" --output .negplan.md
```

Validate a hand-written or agent-filled ledger (exits non-zero on failure):

```bash
negplan validate -f examples/example-ledger.md
```

See a populated, schema-valid ledger: [`examples/example-ledger.md`](./examples/example-ledger.md). The schema that backs `validate` lives at [`schemas/ledger.schema.json`](./schemas/ledger.schema.json), and the blank ledger `init` writes from is at [`templates/ledger.template.md`](./templates/ledger.template.md).

<h2><img src="https://api.iconify.design/tabler:photo.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Demo</h2>

The m1 happy path — `init` writes a fresh will-not-implement ledger, then `validate` goes green:

![demo](assets/demo.gif)

<h2><img src="https://api.iconify.design/tabler:map-2.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Roadmap</h2>

- [x] **m1 — define the ledger.** `negplan init` + `negplan validate`, the [`ledger.schema.json`](./schemas/ledger.schema.json), and the [Claude Code skill](./SKILL.md) that drafts the ledger on any build request.
- [ ] **m2 — enforce the gate.** `negplan gate` maps each diff hunk to a `will_implement` entry by file/id, emits `allowed` / `creep` verdicts, and appends them to the ledger's `gates` audit log. Unmatched hunks block with a one-line reason.
- [ ] **m3 — render the negotiation.** `negplan render` prints a readable veto/allow summary (counts + per-item lines); the inline y/n override panel writes `overridden: true` back into the ledger, moving vetoed items into `will_implement`.
- [ ] **Future.** Cross-agent portability (Cursor / Codex read the same markdown); weekly "what my agent wanted to do (and I vetoed)" share artifact.

v0.1 is free, open-source, MIT-licensed. No paywall, no telemetry, no hosted tier.

<h2><img src="https://api.iconify.design/tabler:license.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> License</h2>

MIT — see [LICENSE](./LICENSE). Issues and PRs are welcome on the [issue tracker](https://github.com/SuperMarioYL/negplan/issues).

<p align="center"><sub><a href="./LICENSE">MIT</a> © 2026 SuperMarioYL</sub></p>
