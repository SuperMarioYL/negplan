[简体中文](./README.zh-CN.md) · [Website](https://negplan.lei6393.com) · [GitHub](https://github.com/SuperMarioYL/negplan)

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/hero-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/hero-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/hero-dark.svg">
  <img src="./assets/presentation/hero-light.svg" width="960" alt="Hero diagram">
</picture>

# negplan

**Write down the work you are deliberately leaving out.**

negplan gives a coding task a portable Markdown ledger with allowed work, excluded work and the reasons for both. The CLI creates and validates that document, gates proposed diffs against the allowed work, and prints a veto/allow summary with human overrides written back.

## Why use it

An exclusion is easier to discuss when it has an ID and rationale beside the requested work. Keeping the agreement in a file makes it available to a person or any agent that can read Markdown.

- **Make exclusions explicit** — Each excluded item keeps its rationale.
- **Keep a portable file** — Markdown can travel with the project.
- **Check the format** — The validator reports fields that violate the schema.

## Architecture

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/architecture-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/architecture-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/architecture-dark.svg">
  <img src="./assets/presentation/architecture-light.svg" width="960" alt="Architecture diagram">
</picture>

init expands a Markdown template. The parser reads YAML frontmatter and three table sections into a typed ledger; a focused validator checks the shipped schema, and serializeLedger writes the canonical form. gate reads a unified diff on stdin, maps each hunk to the will_implement entry its header cites, and records allowed/creep verdicts in the gates table. render prints the veto/allow summary, and --override writes the human's answers back into the ledger.

| Component | Responsibility |
| --- | --- |
| `Markdown template` | templates/ledger.template.md |
| `Ledger parser` | src/ledger.ts |
| `Schema validation` | schemas/ledger.schema.json |
| `Canonical serialization` | serializeLedger |
| `Diff gate` | src/gate.ts |
| `Veto/allow summary` | src/render.ts |

## Install and quickstart

Use the runtime version declared in the repository manifest. The source installation below makes the included example reproducible.

```bash
git clone https://github.com/SuperMarioYL/negplan.git
cd negplan
npm ci
npm run build
```

Node.js 22+; parse and validate the complete example ledger, gate a diff with one cited and one uncited hunk, override one veto, and render the summary.

```bash
node examples/presentation-demo.mjs
```

## Recorded demo

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/process-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/process-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/process-dark.svg">
  <img src="./assets/presentation/process-light.svg" width="960" alt="Process diagram">
</picture>

The example has two allowed and three excluded items; its round trip validates, while status=unexpected fails. The gate then holds one uncited hunk as creep, the human overrides one veto, and the render summarizes everything.

```text
{
  "task": "Build the login page",
  "will_implement": 2,
  "will_not_implement": 3,
  "validation": {
    "valid": true,
    "errors": []
  }
}
roundtrip valid: true
{
  "valid": false,
  "errors": [
    ".status: must be one of drafting, negotiating, gating, done"
  ]
}
gate verdicts: [
  'src/routes/login.ts @@ -1,1 +1,2 @@ satisfies w1 -> allowed (w1)',
  'src/cache.ts @@ -10,1 +10,2 @@ -> creep'
]
negplan — Build the login page (status: negotiating)
will_implement: 3   will_not_implement: 3 (1 overridden)
vetoes:
  n1 OAuth/SSO providers — Out of scope for v0.1; plain session only [veto]
  n2 Password reset email flow — Defer to next sprint; needs an MTA [overridden]
  n3 Rate-limiting middleware — Land after login works; avoid premature infra [veto]
gate verdicts: 1 allowed / 1 creep / 0 overridden
  g1 src/routes/login.ts @@ -1,1 +1,2 @@ satisfies w1 -> allowed (w1)
  g2 src/cache.ts @@ -10,1 +10,2 @@ -> creep
```

The complete command and output are recorded in [docs/demo-results.json](./docs/demo-results.json). Inputs and reproduction code are included in the repository.

![Existing terminal recording](./assets/demo.gif)

The existing recording is retained for context; the text example above documents the reproducible scenario.

## Usage

Run these commands from the repository root after installation. Replace paths for your own data.

```bash
node dist/src/cli.js init --task "Add CSV export" --output .negplan.md
# Fill the allowed/excluded entries in .negplan.md, then:
node dist/src/cli.js validate --file .negplan.md
node dist/src/cli.js validate --file examples/example-ledger.md
# Gate a proposed diff: cite the will_implement entry after the @@ header
printf '+++ b/src/export.ts\n@@ -1,1 +1,2 @@ satisfies w1\n+exportCsv()' | node dist/src/cli.js gate .negplan.md
```

`gate` exits 0 when every hunk cites a `will_implement` entry, 1 when hunks are held as creep, and 2 on a usage or ledger error. Verdict lines are printed per hunk and appended to the ledger's gates table.

```bash
# Print the veto/allow summary (the shareable artifact)
node dist/src/cli.js render .negplan.md
# Override vetoes the human answered "y" to; writes the ledger back
node dist/src/cli.js render .negplan.md --override n2
# Force a held creep hunk through (the human accepts the out-of-scope change)
node dist/src/cli.js override g2 .negplan.md
```

`render --override` marks each listed veto `overridden: true` and moves its intent into `will_implement` as a new entry citing the veto it came from. `override <change_id>` marks a held creep row in the gates table `overridden` with `human_override: true`, recording the human's decision in the audit log; only a `creep` row can be forced through.

## Configuration

A ledger starts with task, optional agent/created_at and status (drafting, negotiating, gating or done). will_implement rows contain id, summary and rationale; will_not_implement adds overridden. gates defines change_id, file, hunk, entry_id, verdict and human_override — the audit trail the gate appends to and `override` updates. init --force overwrites an existing file; omit it to preserve an existing agreement.

## Integrations and responsibilities

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/integrations-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/integrations-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/integrations-dark.svg">
  <img src="./assets/presentation/integrations-light.svg" width="960" alt="Integrations diagram">
</picture>

Choose the input and output route that matches your workflow. The local example below exercises the stated subset.

| Route | Implemented role |
| --- | --- |
| Markdown + YAML | Task and scope decisions |
| init CLI | Create a starting document |
| validate CLI | Document-shape check |
| gate CLI | Hold uncited diff hunks as creep |
| render CLI | Veto/allow summary + override write-back |
| TypeScript functions | Parse and serialize ledgers |
| Agent-readable file | Manual scope agreement |

## Limits and next steps

- The gate matches the `will_implement` entry cited in each hunk header — it does not understand a diff's semantics, so a well-formed but wrong citation passes.
- Validation checks document structure, not whether planned work is appropriate or whether generated code follows it.
- The table parser is a focused format parser, not a complete Markdown implementation. Keep entries in the supplied table format.

v0.2.0 completes the original roadmap: the ledger contract (m1), diff-to-ledger enforcement (m2) and the veto/allow summary with override write-back (m3) all work locally against the portable Markdown ledger. v0.3.0 fixes the init frontmatter quoting and the stale post-override summary, and adds `negplan override` so a held creep hunk can be forced through by the human instead of hand-editing the ledger.

## License and contributions

See [LICENSE](./LICENSE). When reporting an issue, include a minimal input, the command, and the observed output.
