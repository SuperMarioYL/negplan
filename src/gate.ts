// src/gate.ts — the diff-hunk gate (milestone m2).
//
// The gate consumes a unified diff and maps each hunk to a will_implement
// entry by the entry id cited in the hunk header's trailing text — the
// convention SKILL.md teaches ("State the entry id next to each hunk you
// propose"), e.g. `@@ -1,1 +1,2 @@ satisfies w1`. A hunk that cites a known
// entry is `allowed`; a hunk with no citation (or an unknown id) is `creep`
// and is held at the gate until the human overrides it. Verdicts are appended
// to the ledger's gates table, making scope-cutting auditable and reversible.
//
// The citation is structural on purpose: git appends the enclosing function
// signature to every `@@` header by default, so a bare `w<n>` token in that
// text is not evidence that the author cited anything.

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

const DIFF_GIT_PREFIX = "diff --git ";
const PLUS_PREFIX = "+++ ";
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(.*)$/;

// The id counts only as the header's leading token or after a citation word.
const LEADING_ID_RE = /^\s*(w\d+)\b/;
const CITE_WORD_RE = /\b(?:satisfies|implements|cites|for)\s+(w\d+)\b/i;

const SHORT_ESCAPES: Record<string, number> = {
  n: 10,
  t: 9,
  r: 13,
  b: 8,
  f: 12,
  v: 11,
  '"': 34,
  "\\": 92,
};

/** Decode git's C-quoted path form: `"b/\346\226\207.md"` -> `b/文.md`. */
function unquoteGitPath(quoted: string): string {
  const body = quoted.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1));
    if (octal) {
      bytes.push(parseInt(octal[0], 8) & 0xff);
      i += octal[0].length;
      continue;
    }
    const next = body[i + 1] ?? "";
    if (next in SHORT_ESCAPES) {
      bytes.push(SHORT_ESCAPES[next]);
      i += 1;
      continue;
    }
    bytes.push(...Buffer.from(next, "utf8"));
    i += 1;
  }
  return Buffer.from(bytes).toString("utf8");
}

/** The b-side path of a path token, or null for `/dev/null`. */
function bSidePath(path: string): string | null {
  if (path === "/dev/null") return null;
  return path.startsWith("b/") ? path.slice(2) : path;
}

/** The b-side path named by a `diff --git a/… b/…` line, or null. */
function diffGitPath(line: string): string | null {
  const rest = line.slice(DIFF_GIT_PREFIX.length);
  if (rest.startsWith('"')) {
    const quoted = /^("(?:[^"\\]|\\.)*")\s+("(?:[^"\\]|\\.)*")$/.exec(rest);
    return quoted ? bSidePath(unquoteGitPath(quoted[2])) : null;
  }
  // rightmost split: a path may itself contain spaces
  const idx = rest.lastIndexOf(" b/");
  return idx >= 0 ? bSidePath(rest.slice(idx + 3)) : null;
}

/** The b-side path named by a `+++ b/…` line, or null for /dev/null. */
function plusPath(line: string): string | null {
  const rest = line.slice(PLUS_PREFIX.length);
  if (rest.startsWith('"')) {
    const quoted = /^("(?:[^"\\]|\\.)*")/.exec(rest);
    return quoted ? bSidePath(unquoteGitPath(quoted[1])) : null;
  }
  // git appends a tab-delimited timestamp slot when the path contains a
  // space, e.g. `+++ b/user guide.md\t`
  const tab = rest.indexOf("\t");
  return bSidePath(tab >= 0 ? rest.slice(0, tab) : rest);
}

/** Split a unified diff into per-hunk (file, header, section) triples. */
export function parseDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let file = "";
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith(DIFF_GIT_PREFIX)) {
      const path = diffGitPath(line);
      if (path) file = path;
      continue;
    }
    if (line.startsWith(PLUS_PREFIX)) {
      const path = plusPath(line);
      if (path) file = path;
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
  const leading = LEADING_ID_RE.exec(hunk.section);
  if (leading) return leading[1];
  const word = CITE_WORD_RE.exec(hunk.section);
  return word ? word[1] : null;
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
  const cited = header ? citedEntryId({ file: entry.file, hunk: entry.hunk, section: header[1] }) : null;
  return cited
    ? `cites ${cited}, which is not a will_implement entry`
    : "cites no will_implement entry in the hunk header";
}
