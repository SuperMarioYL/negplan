// src/render.ts — the veto/allow summary + override panel (milestone m3).
//
// render prints a readable summary of the ledger: counts of allowed vs creep
// verdicts and per-item lines for every will_not_implement veto, so the human
// can override vetoes (y/n) inline. Overrides are written back into the
// ledger; overridden items move into will_implement.
//
// Not implemented in the m1 release — the m1 milestone defines the ledger
// primitive (init + validate). The negotiation surface lands in m3; see the
// README roadmap.

import type { Ledger } from "./ledger.js";

/** A human-readable veto/allow summary of the ledger. */
export function renderSummary(_ledger: Ledger): string {
  throw new Error(
    "negplan render ships in milestone m3. The m1 release defines the ledger; " +
      "the veto/allow summary + override panel is next. See the README roadmap.",
  );
}
