# Changelog

All notable changes to negplan are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/SuperMarioYL/negplan/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/SuperMarioYL/negplan/releases/tag/v0.2.0
[0.1.0]: https://github.com/SuperMarioYL/negplan/releases/tag/v0.1.0
