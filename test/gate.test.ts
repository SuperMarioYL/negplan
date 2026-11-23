// test/gate.test.ts — the m2 gate: diff parsing, verdicts, change ids, exit codes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { parseLedger, validateLedger, packageRoot } from "../src/ledger.js";
import { gateDiff, parseDiff, citedEntryId, creepReason } from "../src/gate.js";

const EXAMPLE = join(packageRoot(), "examples", "example-ledger.md");
const exampleText = readFileSync(EXAMPLE, "utf8");
const CLI = join(packageRoot(), "dist", "src", "cli.js");

const DIFF = [
  "diff --git a/src/routes/login.ts b/src/routes/login.ts",
  "--- a/src/routes/login.ts",
  "+++ b/src/routes/login.ts",
  "@@ -1,1 +1,2 @@ satisfies w1",
  "+app.post(\"/login\", handler)",
  "diff --git a/src/cache.ts b/src/cache.ts",
  "--- a/src/cache.ts",
  "+++ b/src/cache.ts",
  "@@ -10,1 +10,2 @@",
  "+cacheLayer.warm()",
].join("\n");

function runCli(args: string[], input: string) {
  return spawnSync(process.execPath, [CLI, ...args], { input, encoding: "utf8" });
}

test("parseDiff extracts file, header and citation text per hunk", () => {
  const hunks = parseDiff(DIFF);
  assert.equal(hunks.length, 2);
  assert.equal(hunks[0].file, "src/routes/login.ts");
  assert.equal(hunks[0].hunk, "@@ -1,1 +1,2 @@ satisfies w1");
  assert.equal(hunks[0].section, " satisfies w1");
  assert.equal(hunks[1].file, "src/cache.ts");
  assert.equal(citedEntryId(hunks[0]), "w1");
  assert.equal(citedEntryId(hunks[1]), null);
});

test("gateDiff: cited hunk allowed, uncited hunk creep", () => {
  const ledger = parseLedger(exampleText);
  const entries = gateDiff(ledger, DIFF);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].verdict, "allowed");
  assert.equal(entries[0].entry_id, "w1");
  assert.equal(entries[0].file, "src/routes/login.ts");
  assert.equal(entries[0].human_override, null);
  assert.equal(entries[1].verdict, "creep");
  assert.equal(entries[1].entry_id, null);
  assert.match(entries[0].change_id, /^g\d+$/);
  assert.match(entries[1].change_id, /^g\d+$/);
  // the input ledger is not mutated
  assert.equal(ledger.gates.length, 0);
});

test("gateDiff: a citation naming an unknown entry is creep", () => {
  const ledger = parseLedger(exampleText);
  const diff = "@@ -1,1 +1,2 @@ satisfies w9\n+somethingNew()";
  const [entry] = gateDiff(ledger, diff);
  assert.equal(entry.verdict, "creep");
  assert.equal(entry.entry_id, null);
});

test("gateDiff: git's appended function context is not a citation", () => {
  // git writes the enclosing function signature into the `@@` trailing text by
  // default; an identifier named w1 there used to be read as a citation and
  // silently approved an uncited hunk
  const ledger = parseLedger(exampleText);
  const diff = [
    "diff --git a/src/model.py b/src/model.py",
    "--- a/src/model.py",
    "+++ b/src/model.py",
    "@@ -12,3 +12,4 @@ def scale_weights(w1, w2):",
    "+    total = sum(w1.values())",
  ].join("\n");
  const [entry] = gateDiff(ledger, diff);
  assert.equal(entry.verdict, "creep");
  assert.equal(entry.entry_id, null);
  assert.equal(creepReason(entry), "cites no will_implement entry in the hunk header");
});

test("gateDiff: a citation word or a leading id is still a citation", () => {
  const ledger = parseLedger(exampleText);
  for (const header of [
    "@@ -1,1 +1,2 @@ satisfies w1",
    "@@ -1,1 +1,2 @@ implements w1",
    "@@ -1,1 +1,2 @@ w1",
    "@@ -1,1 +1,2 @@ w1 fixes the login route",
  ]) {
    const [entry] = gateDiff(ledger, `${header}\n+x`);
    assert.equal(entry.verdict, "allowed", header);
    assert.equal(entry.entry_id, "w1", header);
  }
});

test("parseDiff: reads git's real path forms (space paths and C-quoted paths)", () => {
  // git appends a tab-mounted timestamp slot to `+++` lines when the path has a
  // space, and C-quotes non-ASCII paths; both used to be misparsed
  const diff = [
    "diff --git a/user guide.md b/user guide.md",
    "--- a/user guide.md\t",
    "+++ b/user guide.md\t",
    "@@ -1 +1 @@ satisfies w1",
    "-old",
    "+new",
    'diff --git "a/\\346\\226\\207.md" "b/\\346\\226\\207.md"',
    '--- "a/\\346\\226\\207.md"',
    '+++ "b/\\346\\226\\207.md"',
    "@@ -1 +1 @@ satisfies w1",
    "-old",
    "+new",
  ].join("\n");
  const hunks = parseDiff(diff);
  assert.deepEqual(
    hunks.map((h) => h.file),
    ["user guide.md", "文.md"],
  );
});

test("gateDiff: change ids continue past the ledger's existing gates", () => {
  const ledger = parseLedger(exampleText);
  ledger.gates = [
    { change_id: "g3", file: "a.ts", hunk: "@@ -1,1 +1,2 @@", entry_id: null, verdict: "creep", human_override: null },
  ];
  const entries = gateDiff(ledger, "@@ -1,1 +1,2 @@ satisfies w1\n+x");
  assert.equal(entries[0].change_id, "g4");
});

test("creepReason names the citation gap", () => {
  const uncited = { change_id: "g1", file: "a.ts", hunk: "@@ -1,1 +1,2 @@", entry_id: null, verdict: "creep" as const, human_override: null };
  assert.equal(creepReason(uncited), "cites no will_implement entry in the hunk header");
  const unknown = { ...uncited, hunk: "@@ -1,1 +1,2 @@ satisfies w9" };
  assert.equal(creepReason(unknown), "cites w9, which is not a will_implement entry");
});

test("CLI gate: creep hunks exit 1 and the gates table is appended", () => {
  const dir = mkdtempSync(join(tmpdir(), "negplan-gate-"));
  const ledgerPath = join(dir, ".negplan.md");
  writeFileSync(ledgerPath, exampleText, "utf8");
  const r = runCli(["gate", ledgerPath], DIFF);
  assert.equal(r.status, 1, `stderr: ${r.stderr}`);
  assert.ok(r.stdout.includes("allowed (w1)"));
  assert.ok(r.stdout.includes("-> creep"));
  const updated = parseLedger(readFileSync(ledgerPath, "utf8"));
  assert.equal(updated.gates.length, 2);
  assert.equal(updated.gates[0].verdict, "allowed");
  assert.equal(updated.gates[0].entry_id, "w1");
  assert.equal(updated.gates[1].verdict, "creep");
  assert.equal(updated.gates[1].entry_id, null);
});

test("CLI gate: a fully-cited diff exits 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "negplan-gate-"));
  const ledgerPath = join(dir, ".negplan.md");
  writeFileSync(ledgerPath, exampleText, "utf8");
  const diff = "+++ b/src/routes/login.ts\n@@ -1,1 +1,2 @@ satisfies w1\n+x";
  const r = runCli(["gate", ledgerPath], diff);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.ok(r.stdout.includes("1 hunk allowed"));
});

test("CLI gate: an empty diff exits 0 with nothing to gate", () => {
  const r = runCli(["gate", EXAMPLE], "");
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.ok(r.stdout.includes("no hunks found"));
});

test("CLI gate: an invalid ledger exits 2 with the ledger error on stderr", () => {
  const dir = mkdtempSync(join(tmpdir(), "negplan-gate-"));
  const ledgerPath = join(dir, ".negplan.md");
  writeFileSync(ledgerPath, "---\ntask: \"x\"\nstatus: bogus\n---\n", "utf8");
  const r = runCli(["gate", ledgerPath], DIFF);
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes("failed validation"));
  assert.ok(!r.stdout.includes("milestone m2"));
  assert.ok(!r.stdout.includes("roadmap"));
});

test("CLI gate: a missing ledger exits 2, not the roadmap stub text", () => {
  const r = runCli(["gate", "/tmp/does-not-exist.negplan.md"], DIFF);
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes("not found"));
});

test("CLI gate: a hunk whose only w-id is in function context exits 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "negplan-gate-"));
  const ledgerPath = join(dir, ".negplan.md");
  writeFileSync(ledgerPath, exampleText, "utf8");
  const diff = [
    "diff --git a/src/model.py b/src/model.py",
    "--- a/src/model.py",
    "+++ b/src/model.py",
    "@@ -12,3 +12,4 @@ def scale_weights(w1, w2):",
    "+    total = sum(w1.values())",
  ].join("\n");
  const r = runCli(["gate", ledgerPath], diff);
  assert.equal(r.status, 1, `stderr: ${r.stderr}`);
  assert.ok(r.stdout.includes("-> creep"));
  const updated = parseLedger(readFileSync(ledgerPath, "utf8"));
  assert.equal(updated.gates[0].verdict, "creep");
  assert.equal(updated.gates[0].entry_id, null);
});

test("CLI gate: prose around the tables survives the write-back", () => {
  // regression: the ledger is a hand-edited document, but every mutating
  // command used to rebuild it from the parsed object and delete anything
  // that was not one of the four managed blocks
  const dir = mkdtempSync(join(tmpdir(), "negplan-gate-"));
  const ledgerPath = join(dir, ".negplan.md");
  const original = [
    "---",
    'task: "Build the login page"',
    "agent: claude-code",
    'created_at: "2026-08-28T10:00:00Z"',
    "status: negotiating",
    "---",
    "",
    "## Context",
    "",
    "Sessions only; SSO was ruled out with the human.",
    "",
    "## will_implement",
    "",
    "| id | summary | rationale |",
    "| --- | --- | --- |",
    "| w1 | Add POST /login route | Core requirement of this task |",
    "",
    "## will_not_implement",
    "",
    "| id | summary | rationale | overridden |",
    "| --- | --- | --- | --- |",
    "| n1 | OAuth/SSO providers | Out of scope for v0.1 | false |",
    "",
    "## gates",
    "",
    "| change_id | file | hunk | entry_id | verdict | human_override |",
    "| --- | --- | --- | --- | --- | --- |",
    "",
    "## Open questions",
    "",
    "- Should the session cookie be HttpOnly?",
    "",
  ].join("\n");
  writeFileSync(ledgerPath, original, "utf8");
  const r = runCli(["gate", ledgerPath], "+++ b/src/routes/login.ts\n@@ -1,1 +1,2 @@ satisfies w1\n+x");
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const after = readFileSync(ledgerPath, "utf8");
  assert.ok(after.includes("## Context"));
  assert.ok(after.includes("Sessions only; SSO was ruled out with the human."));
  assert.ok(after.includes("## Open questions"));
  assert.ok(after.includes("- Should the session cookie be HttpOnly?"));
  const updated = parseLedger(after);
  assert.equal(updated.gates.length, 1);
  assert.equal(updated.gates[0].verdict, "allowed");
  assert.ok(validateLedger(updated).valid);
});

test("CLI gate: an unwritable ledger exits 2, not the creep code 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "negplan-gate-"));
  const ledgerPath = join(dir, ".negplan.md");
  writeFileSync(ledgerPath, exampleText, "utf8");
  chmodSync(ledgerPath, 0o444);
  try {
    const r = runCli(["gate", ledgerPath], DIFF);
    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.ok(r.stderr.includes("could not write"));
  } finally {
    chmodSync(ledgerPath, 0o644);
  }
  assert.equal(readFileSync(ledgerPath, "utf8"), exampleText);
});
