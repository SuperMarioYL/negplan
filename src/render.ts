// src/render.ts — the veto/allow summary + override panel (milestone m3).
//
// render prints a readable summary of the ledger: counts of allowed vs creep
// verdicts and per-item lines for every will_not_implement veto, so the human
// can override vetoes (y/n) inline. applyOverrides persists the human's
// answers: an overridden veto is marked overridden: true and its intent moves
// into will_implement as a new entry that cites the veto it came from.

import type { Ledger, WillNotImplementEntry, WillImplementEntry } from "./ledger.js";

/** A human-readable veto/allow summary of the ledger. */
export function renderSummary(ledger: Ledger): string {
  const willImpl = ledger.will_implement ?? [];
  const willNot = ledger.will_not_implement ?? [];
  const gates = ledger.gates ?? [];
  const overridden = willNot.filter((e) => e.overridden).length;
  const counts = {
    allowed: gates.filter((g) => g.verdict === "allowed").length,
    creep: gates.filter((g) => g.verdict === "creep").length,
    overridden: gates.filter((g) => g.verdict === "overridden").length,
  };

  const lines: string[] = [];
  lines.push(`negplan — ${ledger.task ?? ""} (status: ${ledger.status ?? "drafting"})`);
  lines.push(
    `will_implement: ${willImpl.length}   will_not_implement: ${willNot.length} (${overridden} overridden)`,
  );
  if (willNot.length > 0) {
    lines.push("vetoes:");
    for (const e of willNot) {
      lines.push(`  ${e.id} ${e.summary} — ${e.rationale} [${e.overridden ? "overridden" : "veto"}]`);
    }
  }
  lines.push(
    `gate verdicts: ${counts.allowed} allowed / ${counts.creep} creep / ${counts.overridden} overridden`,
  );
  for (const g of gates) {
    lines.push(
      `  ${g.change_id} ${g.file} ${g.hunk} -> ${g.verdict}${g.entry_id ? ` (${g.entry_id})` : ""}`,
    );
  }
  return lines.join("\n");
}

/** What applyOverrides did to the ledger. */
export interface OverrideResult {
  ledger: Ledger;
  /** Ids newly overridden in this call. */
  applied: string[];
  /** Ids that were already overridden (no-op, no duplicate will_implement entry). */
  already: string[];
}

/** The next free will_implement id (w<n>) continuing past the existing rows. */
function nextImplementId(ledger: Ledger): number {
  let max = 0;
  for (const e of ledger.will_implement ?? []) {
    const m = /^w(\d+)$/.exec(e.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/**
 * Apply the human's veto overrides: mark each listed will_not_implement item
 * overridden: true and move its intent into will_implement as a new entry
 * whose rationale cites the veto. Unknown ids throw; already-overridden ids
 * are reported in `already` and left untouched.
 */
export function applyOverrides(ledger: Ledger, ids: string[]): OverrideResult {
  const unknown = ids.filter((id) => !(ledger.will_not_implement ?? []).some((e) => e.id === id));
  if (unknown.length > 0) {
    const valid = (ledger.will_not_implement ?? []).map((e) => e.id).join(", ");
    throw new Error(
      `unknown will_not_implement id(s): ${unknown.join(", ")} — valid ids: ${valid || "(none)"}`,
    );
  }

  const applied: string[] = [];
  const already: string[] = [];
  const willNot = (ledger.will_not_implement ?? []).map((e: WillNotImplementEntry) => {
    if (!ids.includes(e.id)) return e;
    if (e.overridden) {
      already.push(e.id);
      return e;
    }
    applied.push(e.id);
    return { ...e, overridden: true };
  });

  const willImpl = [...(ledger.will_implement ?? [])];
  let next = nextImplementId(ledger);
  for (const id of applied) {
    const veto = willNot.find((e) => e.id === id);
    if (!veto) continue;
    const entry: WillImplementEntry = {
      id: `w${next++}`,
      summary: veto.summary,
      rationale: `human override of ${veto.id}: ${veto.rationale}`,
    };
    willImpl.push(entry);
  }

  return { ledger: { ...ledger, will_implement: willImpl, will_not_implement: willNot }, applied, already };
}

/**
 * Force a held creep hunk through: mark the gates row <changeId> verdict
 * "overridden" with human_override: true — the human's answer to a hunk the
 * gate held (schemas define overridden = "human forced a creep hunk through").
 * Only a creep row can be overridden; an unknown or already-decided change id
 * throws with the held creep ids listed.
 */
export function overrideGateVerdict(ledger: Ledger, changeId: string): Ledger {
  const gates = ledger.gates ?? [];
  const row = gates.find((g) => g.change_id === changeId);
  const held = gates
    .filter((g) => g.verdict === "creep")
    .map((g) => g.change_id)
    .join(", ");
  if (!row) {
    throw new Error(
      `unknown gates change_id: ${changeId} — held creep ids: ${held || "(none)"}`,
    );
  }
  if (row.verdict !== "creep") {
    throw new Error(
      `${changeId} is ${row.verdict}, not creep — only a held creep hunk can be overridden — held creep ids: ${held || "(none)"}`,
    );
  }
  return {
    ...ledger,
    gates: gates.map((g) =>
      g === row ? { ...g, verdict: "overridden" as const, human_override: true } : g,
    ),
  };
}
