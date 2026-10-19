// test/render.test.ts — the m3 render: summary, override write-back, exit codes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { parseLedger, validateLedger, serializeLedger, packageRoot } from "../src/ledger.js";
import { renderSummary, applyOverrides, overrideGateVerdict } from "../src/render.js";

const EXAMPLE = join(packageRoot(), "examples", "example-ledger.md");
const exampleText = readFileSync(EXAMPLE, "utf8");
const CLI = join(packageRoot(), "dist", "src", "cli.js");

function runCli(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

test("renderSummary lists every veto with its rationale and state", () => {
  const ledger = parseLedger(exampleText);
  const summary = renderSummary(ledger);
  assert.ok(summary.includes("negplan — Build the login page (status: negotiating)"));
  assert.ok(summary.includes("will_implement: 2   will_not_implement: 3 (0 overridden)"));
  assert.ok(summary.includes("n1 OAuth/SSO providers — Out of scope for v0.1; plain session only [veto]"));
  assert.ok(summary.includes("n2 Password reset email flow"));
  assert.ok(summary.includes("n3 Rate-limiting middleware"));
  assert.ok(summary.includes("gate verdicts: 0 allowed / 0 creep / 0 overridden"));
});

test("renderSummary marks overridden vetoes and counts gate verdicts", () => {
  const ledger = parseLedger(exampleText);
  const { ledger: negotiated } = applyOverrides(ledger, ["n2"]);
  negotiated.gates = [
    { change_id: "g1", file: "src/a.ts", hunk: "@@ -1,1 +1,2 @@ satisfies w1", entry_id: "w1", verdict: "allowed", human_override: null },
    { change_id: "g2", file: "src/b.ts", hunk: "@@ -9,1 +9,2 @@", entry_id: null, verdict: "creep", human_override: null },
  ];
  const summary = renderSummary(negotiated);
  assert.ok(summary.includes("(1 overridden)"));
  assert.ok(summary.includes("n2 Password reset email flow — Defer to next sprint; needs an MTA [overridden]"));
  assert.ok(summary.includes("gate verdicts: 1 allowed / 1 creep / 0 overridden"));
  assert.ok(summary.includes("g2 src/b.ts @@ -9,1 +9,2 @@ -> creep"));
});

test("applyOverrides flips the veto and moves it into will_implement", () => {
  const ledger = parseLedger(exampleText);
  const { ledger: out, applied, already } = applyOverrides(ledger, ["n2"]);
  assert.deepEqual(applied, ["n2"]);
  assert.deepEqual(already, []);
  const veto = out.will_not_implement.find((e) => e.id === "n2");
  assert.equal(veto?.overridden, true);
  assert.equal(out.will_implement.length, 3);
  const moved = out.will_implement.find((e) => e.id === "w3");
  assert.equal(moved?.summary, "Password reset email flow");
  assert.match(moved?.rationale ?? "", /human override of n2: Defer to next sprint/);
  assert.ok(validateLedger(out).valid);
  // the input ledger is not mutated
  assert.equal(ledger.will_implement.length, 2);
});

test("applyOverrides is idempotent for an already-overridden id", () => {
  const ledger = parseLedger(exampleText);
  const once = applyOverrides(ledger, ["n2"]);
  const twice = applyOverrides(once.ledger, ["n2"]);
  assert.deepEqual(twice.applied, []);
  assert.deepEqual(twice.already, ["n2"]);
  assert.equal(twice.ledger.will_implement.length, once.ledger.will_implement.length);
});

test("applyOverrides fails on unknown ids, listing the valid ones", () => {
  const ledger = parseLedger(exampleText);
  assert.throws(() => applyOverrides(ledger, ["n9"]), /n9/);
  assert.throws(() => applyOverrides(ledger, ["n9"]), /n1, n2, n3/);
});

test("CLI render: prints the summary read-only (exit 0)", () => {
  const r = runCli(["render", EXAMPLE]);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.ok(r.stdout.includes("n1 OAuth/SSO providers"));
  assert.ok(r.stdout.includes("[veto]"));
});

test("CLI render: --override writes the ledger back", () => {
  const dir = mkdtempSync(join(tmpdir(), "negplan-render-"));
  const ledgerPath = join(dir, ".negplan.md");
  writeFileSync(ledgerPath, exampleText, "utf8");
  const r = runCli(["render", ledgerPath, "--override", "n2"]);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.ok(r.stdout.includes("overrode n2"));
  const updated = parseLedger(readFileSync(ledgerPath, "utf8"));
  assert.equal(updated.will_not_implement.find((e) => e.id === "n2")?.overridden, true);
  assert.equal(updated.will_implement.some((e) => e.id === "w3" && /human override of n2/.test(e.rationale)), true);
  assert.ok(validateLedger(updated).valid);
  // the printed summary reflects the persisted post-override state, not the
  // pre-override ledger (regression: it used to still show n2 as [veto])
  assert.ok(r.stdout.includes("n2 Password reset email flow — Defer to next sprint; needs an MTA [overridden]"));
  assert.ok(!r.stdout.includes("n2 Password reset email flow — Defer to next sprint; needs an MTA [veto]"));
  assert.ok(r.stdout.includes("will_implement: 3   will_not_implement: 3 (1 overridden)"));
});

test("CLI render: an unknown override id exits non-zero on stderr", () => {
  const r = runCli(["render", EXAMPLE, "--override", "n9"]);
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes("n9"));
  assert.ok(r.stderr.includes("n1, n2, n3"));
});

test("CLI render: an invalid ledger exits non-zero with the ledger error", () => {
  const dir = mkdtempSync(join(tmpdir(), "negplan-render-"));
  const ledgerPath = join(dir, ".negplan.md");
  writeFileSync(ledgerPath, "---\ntask: \"x\"\nstatus: bogus\n---\n", "utf8");
  const r = runCli(["render", ledgerPath]);
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes("failed validation"));
  assert.ok(!r.stdout.includes("milestone m3"));
});

// --- override: forcing a held creep hunk through -----------------------------

/** A copy of the example ledger with one allowed and one creep gates row. */
function ledgerWithGates(dir: string): string {
  const ledger = parseLedger(exampleText);
  ledger.gates = [
    { change_id: "g1", file: "src/a.ts", hunk: "@@ -1,1 +1,2 @@ satisfies w1", entry_id: "w1", verdict: "allowed", human_override: null },
    { change_id: "g2", file: "src/b.ts", hunk: "@@ -9,1 +9,2 @@", entry_id: null, verdict: "creep", human_override: null },
  ];
  const path = join(dir, ".negplan.md");
  writeFileSync(path, serializeLedger(ledger), "utf8");
  return path;
}

test("overrideGateVerdict flips a creep row to overridden with human_override", () => {
  const ledger = parseLedger(exampleText);
  ledger.gates = [
    { change_id: "g1", file: "src/b.ts", hunk: "@@ -9,1 +9,2 @@", entry_id: null, verdict: "creep", human_override: null },
  ];
  const out = overrideGateVerdict(ledger, "g1");
  assert.deepEqual(out.gates[0], {
    change_id: "g1",
    file: "src/b.ts",
    hunk: "@@ -9,1 +9,2 @@",
    entry_id: null,
    verdict: "overridden",
    human_override: true,
  });
  assert.ok(validateLedger(out).valid);
  // the input ledger is not mutated
  assert.equal(ledger.gates[0].verdict, "creep");
});

test("overrideGateVerdict throws on an unknown id and on a non-creep row, listing the held ids", () => {
  const ledger = parseLedger(exampleText);
  ledger.gates = [
    { change_id: "g1", file: "src/a.ts", hunk: "@@ -1,1 +1,2 @@ satisfies w1", entry_id: "w1", verdict: "allowed", human_override: null },
    { change_id: "g2", file: "src/b.ts", hunk: "@@ -9,1 +9,2 @@", entry_id: null, verdict: "creep", human_override: null },
  ];
  assert.throws(() => overrideGateVerdict(ledger, "g9"), /g9/);
  assert.throws(() => overrideGateVerdict(ledger, "g9"), /g2/);
  assert.throws(() => overrideGateVerdict(ledger, "g1"), /allowed, not creep/);
  assert.throws(() => overrideGateVerdict(ledger, "g1"), /g2/);
});

test("CLI override: a held creep row is forced through and written back", () => {
  const dir = mkdtempSync(join(tmpdir(), "negplan-override-"));
  const ledgerPath = ledgerWithGates(dir);
  const r = runCli(["override", "g2", ledgerPath]);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.ok(r.stdout.includes("g2 overridden (human_override: true)"));
  const updated = parseLedger(readFileSync(ledgerPath, "utf8"));
  assert.equal(updated.gates.find((g) => g.change_id === "g2")?.verdict, "overridden");
  assert.equal(updated.gates.find((g) => g.change_id === "g2")?.human_override, true);
  assert.ok(validateLedger(updated).valid);
  // the refreshed counts appear in the printed summary
  assert.ok(r.stdout.includes("gate verdicts: 1 allowed / 0 creep / 1 overridden"));
});

test("CLI override: an unknown or non-creep id exits non-zero and leaves the file unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "negplan-override-"));
  const ledgerPath = ledgerWithGates(dir);
  const before = readFileSync(ledgerPath, "utf8");
  for (const id of ["g9", "g1"]) {
    const r = runCli(["override", id, ledgerPath]);
    assert.notEqual(r.status, 0, `override ${id} should fail`);
    assert.ok(r.stderr.includes(id));
    assert.ok(r.stderr.includes("g2"), `held ids listed for ${id}`);
  }
  assert.equal(readFileSync(ledgerPath, "utf8"), before);
});
