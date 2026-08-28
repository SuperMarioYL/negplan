// test/ledger.test.ts — round-trip, validation, and init tests for the ledger.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseLedger,
  serializeLedger,
  validateLedger,
  packageRoot,
  templatePath,
  LedgerError,
} from "../src/ledger.js";

const EXAMPLE = join(packageRoot(), "examples", "example-ledger.md");
const exampleText = readFileSync(EXAMPLE, "utf8");

test("parseLedger parses the hand-written example", () => {
  const ledger = parseLedger(exampleText);
  assert.equal(ledger.task, "Build the login page");
  assert.equal(ledger.agent, "claude-code");
  assert.equal(ledger.created_at, "2026-08-28T10:00:00Z");
  assert.equal(ledger.status, "negotiating");
  assert.equal(ledger.will_implement.length, 2);
  assert.equal(ledger.will_not_implement.length, 3);
  assert.equal(ledger.gates.length, 0);
  assert.deepEqual(ledger.will_implement[0], {
    id: "w1",
    summary: "Add POST /login route",
    rationale: "Core requirement of this task",
  });
  assert.equal(ledger.will_not_implement[0].overridden, false);
  assert.equal(ledger.will_not_implement[0].id, "n1");
});

test("validateLedger passes on the hand-written example", () => {
  const { valid, errors } = validateLedger(parseLedger(exampleText));
  assert.ok(valid, errors.join("; "));
});

test("serializeLedger round-trips: parse(serialize(parsed)) deep-equals parsed", () => {
  const parsed = parseLedger(exampleText);
  const reparsed = parseLedger(serializeLedger(parsed));
  assert.deepEqual(reparsed, parsed);
});

test("a fresh init ledger (empty tables) validates green", () => {
  const template = readFileSync(templatePath(), "utf8")
    .replaceAll("{{TASK}}", "Ship the dashboard")
    .replaceAll("{{AGENT}}", "claude-code")
    .replaceAll("{{CREATED_AT}}", "2026-08-28T10:00:00Z");
  const ledger = parseLedger(template);
  assert.equal(ledger.will_implement.length, 0);
  assert.equal(ledger.will_not_implement.length, 0);
  assert.equal(ledger.gates.length, 0);
  const { valid, errors } = validateLedger(ledger);
  assert.ok(valid, errors.join("; "));
});

test("validateLedger rejects an id that violates the w<n> / n<n> / g<n> pattern", () => {
  const ledger = {
    task: "t",
    status: "drafting",
    will_implement: [{ id: "x1", summary: "a", rationale: "b" }],
    will_not_implement: [],
    gates: [],
  };
  const { valid, errors } = validateLedger(ledger);
  assert.ok(!valid);
  assert.ok(errors.some((e) => e.includes("x1") && e.includes("/")));
});

test("validateLedger rejects an unknown status enum", () => {
  const ledger = {
    task: "t",
    status: "vibing",
    will_implement: [],
    will_not_implement: [],
    gates: [],
  };
  const { valid } = validateLedger(ledger);
  assert.ok(!valid);
});

test("validateLedger rejects a missing required field", () => {
  const ledger = {
    status: "drafting",
    will_implement: [],
    will_not_implement: [],
    gates: [],
  };
  const { valid, errors } = validateLedger(ledger);
  assert.ok(!valid);
  assert.ok(errors.some((e) => e.includes("task")));
});

test("validateLedger rejects additional frontmatter properties", () => {
  const ledger = {
    task: "t",
    status: "drafting",
    surprise: "no",
    will_implement: [],
    will_not_implement: [],
    gates: [],
  };
  const { valid, errors } = validateLedger(ledger);
  assert.ok(!valid);
  assert.ok(errors.some((e) => e.includes("surprise")));
});

test("validateLedger accepts a gate entry with null entry_id and null override", () => {
  const ledger = {
    task: "t",
    status: "gating",
    will_implement: [{ id: "w1", summary: "a", rationale: "b" }],
    will_not_implement: [],
    gates: [
      {
        change_id: "g1",
        file: "src/a.ts",
        hunk: "@@ -1,1 +1,2 @@",
        entry_id: null,
        verdict: "creep",
        human_override: null,
      },
    ],
  };
  const { valid, errors } = validateLedger(ledger);
  assert.ok(valid, errors.join("; "));
});

test("parseLedger throws on a document without frontmatter", () => {
  assert.throws(() => parseLedger("just some prose\nno ledger here"), LedgerError);
});
