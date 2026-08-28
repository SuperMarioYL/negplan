// src/gate.ts — the diff-hunk gate (milestone m2).
//
// The gate consumes a unified diff on stdin and maps each hunk to a
// will_implement entry by file/id. A hunk that matches an entry is `allowed`;
// a hunk with no entry is `creep` and is held at the gate until the human
// overrides it. Verdicts are appended to the ledger's gates table, making
// scope-cutting auditable and reversible.
//
// Not implemented in the m1 release — the m1 milestone defines the ledger
// primitive (init + validate). Enforcement lands in m2; see the README roadmap.

import type { Ledger, GateEntry } from "./ledger.js";

/**
 * Gate a unified diff against the ledger's will_implement entries.
 * @returns one GateEntry verdict per diff hunk.
 */
export function gateDiff(_ledger: Ledger, _diff: string): GateEntry[] {
  throw new Error(
    "negplan gate ships in milestone m2. The m1 release defines the ledger; " +
      "diff enforcement is next. See the README roadmap.",
  );
}
