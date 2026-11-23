// test/ledger.test.ts — round-trip, validation, and init tests for the ledger.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  parseLedger,
  serializeLedger,
  mergeLedgerDocument,
  validateLedger,
  packageRoot,
  templatePath,
  yamlQuote,
  LedgerError,
} from "../src/ledger.js";

const EXAMPLE = join(packageRoot(), "examples", "example-ledger.md");
const exampleText = readFileSync(EXAMPLE, "utf8");
const CLI = join(packageRoot(), "dist", "src", "cli.js");

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
    .replaceAll("{{TASK}}", yamlQuote("Ship the dashboard"))
    .replaceAll("{{AGENT}}", yamlQuote("claude-code"))
    .replaceAll("{{CREATED_AT}}", yamlQuote("2026-08-28T10:00:00Z"));
  const ledger = parseLedger(template);
  assert.equal(ledger.will_implement.length, 0);
  assert.equal(ledger.will_not_implement.length, 0);
  assert.equal(ledger.gates.length, 0);
  const { valid, errors } = validateLedger(ledger);
  assert.ok(valid, errors.join("; "));
});

test("CLI init: a task containing double quotes produces a ledger that validates", () => {
  // regression: the template used to pre-quote the placeholders, so a raw
  // substitution broke the frontmatter and validate failed on the fresh file
  const dir = mkdtempSync(join(tmpdir(), "negplan-init-"));
  const out = join(dir, ".negplan.md");
  const task = 'build the "login" page';
  const r = spawnSync(process.execPath, [CLI, "init", "--task", task, "--output", out], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const ledger = parseLedger(readFileSync(out, "utf8"));
  assert.equal(ledger.task, task);
  const { valid, errors } = validateLedger(ledger);
  assert.ok(valid, errors.join("; "));
});

test("CLI init: a task containing a backslash round-trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "negplan-init-"));
  const out = join(dir, ".negplan.md");
  const task = "cache path C:\\tmp\\cache";
  const r = spawnSync(process.execPath, [CLI, "init", "--task", task, "--output", out], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const ledger = parseLedger(readFileSync(out, "utf8"));
  assert.equal(ledger.task, task);
  // and the serialized form stays valid too
  const { valid } = validateLedger(parseLedger(serializeLedger(ledger)));
  assert.ok(valid);
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

test("parseLedger honors escaped pipes in table cells", () => {
  const text = [
    "---",
    'task: "t"',
    "status: drafting",
    "---",
    "",
    "## will_implement",
    "",
    "| id | summary | rationale |",
    "| --- | --- | --- |",
    "| w1 | Use A \\| B | Core \\| reason |",
    "",
  ].join("\n");
  const ledger = parseLedger(text);
  assert.deepEqual(ledger.will_implement[0], {
    id: "w1",
    summary: "Use A | B",
    rationale: "Core | reason",
  });
});

test("serializeLedger escapes pipes and round-trips pipe-bearing cells losslessly", () => {
  const text = parseLedger(
    [
      "---",
      'task: "t"',
      "status: gating",
      "---",
      "",
      "## will_implement",
      "",
      "| id | summary | rationale |",
      "| --- | --- | --- |",
      "| w1 | Add A\\|B switch | Keep both \\| C branches |",
      "",
    ].join("\n"),
  );
  assert.equal(text.will_implement[0].summary, "Add A|B switch");
  assert.equal(text.will_implement[0].rationale, "Keep both | C branches");
  const out = serializeLedger(text);
  // the pipe inside each cell is escaped on write
  assert.ok(out.includes("Add A\\|B switch"));
  assert.ok(out.includes("Keep both \\| C branches"));
  // and the round trip is lossless
  assert.deepEqual(parseLedger(out), text);
});

test("unescaped pipes still split columns — escape them (\\|) to keep a literal pipe", () => {
  // a row with more columns than the section header keeps only the first N
  // cells; escape the pipe if it is meant to be cell content
  const ledger = parseLedger(
    [
      "---",
      'task: "t"',
      "status: drafting",
      "---",
      "",
      "## will_implement",
      "",
      "| id | summary | rationale |",
      "| --- | --- | --- |",
      "| w1 | Use A | B |",
      "",
    ].join("\n"),
  );
  assert.deepEqual(ledger.will_implement[0], { id: "w1", summary: "Use A", rationale: "B" });
});

test("CLI init: a task containing a newline round-trips", () => {
  // regression: yamlQuote escaped quotes and backslashes but not line breaks,
  // so init exited 0 having written frontmatter the parser rejects
  const dir = mkdtempSync(join(tmpdir(), "negplan-init-"));
  const out = join(dir, ".negplan.md");
  const task = "line one\nline two\tafter a tab";
  const r = spawnSync(process.execPath, [CLI, "init", "--task", task, "--output", out], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const ledger = parseLedger(readFileSync(out, "utf8"));
  assert.equal(ledger.task, task);
  const { valid, errors } = validateLedger(ledger);
  assert.ok(valid, errors.join("; "));
});

test("mergeLedgerDocument keeps prose and replaces only the managed tables", () => {
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
  const ledger = parseLedger(original);
  ledger.gates = [
    { change_id: "g1", file: "src/a.ts", hunk: "@@ -1,1 +1,2 @@ satisfies w1", entry_id: "w1", verdict: "allowed", human_override: null },
  ];

  const merged = mergeLedgerDocument(original, ledger);
  const reparsed = parseLedger(merged);

  // the verdict landed in the gates table ...
  assert.deepEqual(reparsed.gates, ledger.gates);
  // ... and every line the human wrote is still there, in order
  assert.ok(merged.includes("## Context\n\nSessions only; SSO was ruled out with the human.\n"));
  assert.ok(merged.includes("## Open questions\n\n- Should the session cookie be HttpOnly?\n"));
  assert.ok(validateLedger(reparsed).valid);
  // the untouched entries round-trip
  assert.deepEqual(reparsed.will_implement, ledger.will_implement);
  assert.deepEqual(reparsed.will_not_implement, ledger.will_not_implement);
});

test("mergeLedgerDocument appends a managed section the document is missing", () => {
  const original = [
    "---",
    'task: "t"',
    "agent: claude-code",
    'created_at: "2026-08-28T10:00:00Z"',
    "status: drafting",
    "---",
    "",
    "## will_implement",
    "",
    "| id | summary | rationale |",
    "| --- | --- | --- |",
    "| w1 | a | b |",
    "",
  ].join("\n");
  const merged = mergeLedgerDocument(original, parseLedger(original));
  const reparsed = parseLedger(merged);
  assert.equal(reparsed.will_implement.length, 1);
  assert.deepEqual(reparsed.will_not_implement, []);
  assert.deepEqual(reparsed.gates, []);
  assert.ok(validateLedger(reparsed).valid);
});
