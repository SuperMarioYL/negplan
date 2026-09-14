// test/gate.test.ts — the m2 gate: diff parsing, verdicts, change ids, exit codes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { parseLedger, packageRoot } from "../src/ledger.js";
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
