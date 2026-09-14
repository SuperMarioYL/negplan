[简体中文](./README.zh-CN.md) · [Website](https://negplan.lei6393.com) · [GitHub](https://github.com/SuperMarioYL/negplan)

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/hero-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/hero-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/hero-dark.svg">
  <img src="./assets/presentation/hero-light.svg" width="960" alt="Hero diagram">
</picture>

# negplan

**Write down the work you are deliberately leaving out.**

negplan gives a coding task a portable Markdown ledger with allowed work, excluded work and the reasons for both. The current CLI creates and validates that document.

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

init expands a Markdown template. The parser reads YAML frontmatter and three table sections into a typed ledger; a focused validator checks the shipped schema, and serializeLedger writes the canonical form. gate reads a unified diff on stdin, maps each hunk to the will_implement entry its header cites, and records allowed/creep verdicts in the gates table; render is a milestone placeholder.

| Component | Responsibility |
| --- | --- |
| `Markdown template` | templates/ledger.template.md |
| `Ledger parser` | src/ledger.ts |
| `Schema validation` | schemas/ledger.schema.json |
| `Canonical serialization` | serializeLedger |
| `Diff gate` | src/gate.ts |

## Install and quickstart

Use the runtime version declared in the repository manifest. The source installation below makes the included example reproducible.

```bash
git clone https://github.com/SuperMarioYL/negplan.git
cd negplan
npm ci
npm run build
```

Node.js 22+; parse the complete example ledger, round-trip it and reject an invalid lifecycle status.

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

The example has two allowed and three excluded items; its round trip validates, while status=unexpected fails.

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

## Configuration

A ledger starts with task, optional agent/created_at and status (drafting, negotiating, gating or done). will_implement rows contain id, summary and rationale; will_not_implement adds overridden. gates defines change_id, file, hunk, entry_id, verdict and human_override for future enforcement records. init --force overwrites an existing file; omit it to preserve an existing agreement.

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
| TypeScript functions | Parse and serialize ledgers |
| Agent-readable file | Manual scope agreement |

## Limits and next steps

- The gate matches the `will_implement` entry cited in each hunk header — it does not understand a diff's semantics, so a well-formed but wrong citation passes. The interactive veto/override renderer (`render`) is not implemented yet; its command prints roadmap text and may exit zero.
- Validation checks document structure, not whether planned work is appropriate or whether generated code follows it.
- The table parser is a focused format parser, not a complete Markdown implementation. Keep entries in the supplied table format.

v0.2.0 implements m2, diff-to-ledger enforcement. m3, the veto/allow summary and override interface, is next; the current release provides the ledger contract plus the gate.

## License and contributions

See [LICENSE](./LICENSE). When reporting an issue, include a minimal input, the command, and the observed output.
