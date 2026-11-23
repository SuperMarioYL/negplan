# Changelog

All notable changes to negplan are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-11-24

### Fixed

- `negplan gate` reads a citation only in a citation position: the `w<n>` id
  must follow `satisfies`, `implements`, `cites` or `for`, or be the first thing
  after the `@@` header. Git appends the enclosing function signature to every
  hunk header by default, so a bare `w<n>` token there — `@@ -12,3 +12,4 @@
  def scale(w1, w2):` — used to be read as a citation and the hunk was reported
  `allowed` (exit 0) although nothing was cited. Such a hunk is now held as
  creep; `negplan override <change_id>` forces it through when a human accepts
  it.
- `negplan gate` records the file the hunk actually touches for real `git diff`
  output: a path containing a space no longer keeps the tab git appends to the
  `+++` line, and a non-ASCII path (written by git in its quoted `"\346..."`
  form) is decoded instead of being attributed to the previous file.
- `negplan gate`, `negplan render --override` and `negplan override` write the
  ledger back without discarding prose: only the three managed tables and the
  frontmatter are replaced, so context notes, comments and sections you added
  to the `.negplan.md` file survive a verdict.
- A ledger that cannot be written is reported as exit 2 (usage/ledger error)
  with the file left unchanged, instead of exit 1 — the code that means "hunks
  held as creep" and would send the caller looking for a verdict that was never
  recorded.
- `negplan init` escapes line breaks in `--task` and `--agent`: a task
  containing a newline or tab used to produce frontmatter that no command could
  parse, while `init` reported success and exited 0.

## [0.3.0] - 2026-10-20

### Fixed

- `negplan init` no longer writes invalid YAML frontmatter when the task or
  agent contains double quotes or backslashes: frontmatter scalars are quoted
  by the ledger module (the single owner of format quoting), so the file it
  just created always passes `negplan validate`.
- `negplan render --override` prints the updated summary — the overridden veto
  marked `[overridden]` and the moved `will_implement` entry — instead of the
  stale pre-override state.

### Added

- `negplan override <change_id>`: force a held creep hunk through. The gates
  row becomes `verdict: overridden` with `human_override: true`, recording the
  human's decision in the audit log. Unknown or non-creep change ids are
  rejected with the held creep ids listed.

## [0.2.0] - 2026-09-15

### Fixed

- `negplan gate` is implemented (plan milestone m2): it reads a unified diff on
  stdin, maps each hunk to the `will_implement` entry cited in its `@@` header,
  records allowed/creep verdicts in the ledger's gates table, and exits
  0 (all allowed) / 1 (hunks held as creep) / 2 (usage or ledger error).
  Previously it was a stub that ignored the diff, printed its failure text to
  stdout and always exited 0.
- `negplan render` is implemented (plan milestone m3): it prints the veto/allow
  summary — every veto with its rationale and `[veto]`/`[overridden]` state
  plus the gate verdict log — and `--override n1,n2` writes the human's
  answers back into the ledger, marking vetoes `overridden: true` and moving
  them into `will_implement` as entries citing the veto they came from.
  Previously a stub that exited 0.
- The ledger parser honors markdown-escaped `\|` in table cells and the
  serializer escapes `|` on write, so pipe-bearing cell content round-trips
  losslessly instead of silently shifting columns and dropping the tail.

### Added

- This CHANGELOG.md.
- A version-lockstep test: `package.json`, the `VERSION` file and the CLI's
  `--version` output must agree with the changelog's latest section.

## [0.1.0] - 2026-08-28

- Initial m1 release: the will-not-implement ledger format (YAML frontmatter +
  three markdown tables), `negplan init`, `negplan validate`, the
  `schemas/ledger.schema.json` validator, the ledger template, and the
  Claude Code skill that drafts the ledger on a build request.

[Unreleased]: https://github.com/SuperMarioYL/negplan/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/SuperMarioYL/negplan/releases/tag/v0.4.0
[0.3.0]: https://github.com/SuperMarioYL/negplan/releases/tag/v0.3.0
[0.2.0]: https://github.com/SuperMarioYL/negplan/releases/tag/v0.2.0
[0.1.0]: https://github.com/SuperMarioYL/negplan/releases/tag/v0.1.0
