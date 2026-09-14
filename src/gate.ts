// src/gate.ts — the diff-hunk gate (milestone m2).
//
// The gate consumes a unified diff and maps each hunk to a will_implement
// entry by the entry id cited in the hunk header's trailing text — the
// convention SKILL.md teaches ("State the entry id next to each hunk you
// propose"), e.g. `@@ -1,1 +1,2 @@ satisfies w1`. A hunk that cites a known
// entry is `allowed`; a hunk with no citation (or an unknown id) is `creep`
// and is held at the gate until the human overrides it. Verdicts are appended
// to the ledger's gates table, making scope-cutting auditable and reversible.

import type { Ledger, GateEntry, WillImplementEntry } from "./ledger.js";

/** One hunk extracted from a unified diff. */
export interface DiffHunk {
  /** Path on the b/ side of the diff (the file the hunk writes into). */
  file: string;
  /** The full `@@ … @@` header line, citation text included. */
  hunk: string;
  /** The free text after the second `@@` — where the citation lives. */
  section: string;
}

const DIFF_GIT_RE = /^diff --git a\/(.+?) b\/(.+?)(?:\s|$)/;
const PLUS_FILE_RE = /^\+\+\+ b\/(.+)$/;
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(.*)$/;
const CITED_ID_RE = /\bw\d+\b/;

/** Split a unified diff into per-hunk (file, header, section) triples. */
export function parseDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let file = "";
  for (const line of diff.split(/\r?\n/)) {
    const git = DIFF_GIT_RE.exec(line);
    if (git) {
      file = git[2];
      continue;
    }
    const plus = PLUS_FILE_RE.exec(line);
    if (plus) {
      file = plus[1];
      continue;
    }
    const hunk = HUNK_RE.exec(line);
    if (hunk) {
      hunks.push({ file: file || "(unknown)", hunk: line, section: hunk[1] });
    }
  }
  return hunks;
}

/** The will_implement entry id a hunk header cites, if any. */
export function citedEntryId(hunk: DiffHunk): string | null {
  const m = CITED_ID_RE.exec(hunk.section);
  return m ? m[0] : null;
}

/** The next free change id (g<n>) continuing past the ledger's existing rows. */
function nextChangeId(ledger: Ledger): string {
  let max = 0;
  for (const g of ledger.gates ?? []) {
    const m = /^g(\d+)$/.exec(g.change_id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `g${max + 1}`;
}

/**
 * Gate a unified diff against the ledger's will_implement entries.
 * @returns one GateEntry verdict per diff hunk, in diff order.
 */
export function gateDiff(ledger: Ledger, diff: string): GateEntry[] {
  const known = new Set<string>(
    (ledger.will_implement ?? []).map((e: WillImplementEntry) => e.id),
  );
  const entries: GateEntry[] = [];
  let changeId = nextChangeId(ledger);
  for (const hunk of parseDiff(diff)) {
    const cited = citedEntryId(hunk);
    const allowed = cited !== null && known.has(cited);
    const num = Number(changeId.slice(1));
    entries.push({
      change_id: changeId,
      file: hunk.file,
      hunk: hunk.hunk,
      entry_id: allowed ? cited : null,
      verdict: allowed ? "allowed" : "creep",
      human_override: null,
    });
    changeId = `g${num + 1}`;
  }
  return entries;
}

/** A one-line reason for a creep verdict, for the gate's scriptable output. */
export function creepReason(entry: GateEntry): string {
  const header = HUNK_RE.exec(entry.hunk);
  const cited = header ? CITED_ID_RE.exec(header[1]) : null;
  return cited
    ? `cites ${cited[0]}, which is not a will_implement entry`
    : "cites no will_implement entry in the hunk header";
}
