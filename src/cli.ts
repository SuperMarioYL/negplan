#!/usr/bin/env node
// src/cli.ts — negplan CLI: init | validate | gate | render
//
// The agent shells out to this CLI; the ledger is a file on disk. No daemon,
// no second process beyond the agent itself.

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline/promises";
import { stdin } from "node:process";
import { Command } from "commander";
import {
  parseLedger,
  validateLedger,
  serializeLedger,
  templatePath,
  packageRoot,
  LedgerError,
} from "./ledger.js";
import { gateDiff, creepReason } from "./gate.js";
import { renderSummary, applyOverrides } from "./render.js";

const DEFAULT_LEDGER = ".negplan.md";
const VERSION = readVersion();

function readVersion(): string {
  try {
    const p = join(packageRoot(), "package.json");
    return JSON.parse(readFileSync(p, "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function fail(message: string, code = 1): never {
  process.stderr.write(`negplan: ${message}\n`);
  process.exit(code);
}

interface InitOptions {
  task?: string;
  output?: string;
  force?: boolean;
  agent?: string;
}

async function runInit(opts: InitOptions): Promise<void> {
  const outPath = opts.output ?? DEFAULT_LEDGER;
  if (existsSync(outPath) && !opts.force) {
    fail(
      `${outPath} already exists — pass --force to overwrite, or --output to write elsewhere.`,
    );
  }
  let task = opts.task;
  if (!task) {
    if (stdin.isTTY) {
      task = await prompt("Task the agent should work on: ");
      if (!task) fail("a task is required (the ledger's will-not-implement list is per-task).");
    } else {
      fail(
        "no --task provided and stdin is not a terminal — pass --task \"<your task>\".",
      );
    }
  }
  const agent = opts.agent ?? "claude-code";
  const createdAt = new Date().toISOString();

  const template = readFileSync(templatePath(), "utf8");
  const content = template
    .replaceAll("{{TASK}}", task)
    .replaceAll("{{AGENT}}", agent)
    .replaceAll("{{CREATED_AT}}", createdAt);

  writeFileSync(outPath, content, "utf8");
  process.stdout.write(`negplan: wrote ${outPath} (task: "${task}")\n`);
  process.stdout.write(
    `next: open it, then ask your agent to fill the will_implement + will_not_implement lists.\n`,
  );
}

interface ValidateOptions {
  file?: string;
}

function runValidate(opts: ValidateOptions): void {
  const path = opts.file ?? DEFAULT_LEDGER;
  if (!existsSync(path)) fail(`${path} not found — run "negplan init" first.`);
  const content = readFileSync(path, "utf8");
  let ledger: unknown;
  try {
    ledger = parseLedger(content);
  } catch (e) {
    if (e instanceof LedgerError) fail(`${path}: ${e.message}`);
    throw e;
  }
  const { valid, errors } = validateLedger(ledger);
  if (valid) {
    process.stdout.write(`negplan: ${path} is valid.\n`);
    process.exit(0);
  }
  process.stderr.write(`negplan: ${path} failed validation:\n`);
  for (const e of errors) process.stderr.write(`  - ${e}\n`);
  process.exit(1);
}

/** Parse + validate a ledger file, or fail with a usage-level error. */
function loadLedger(path: string, errorCode: number): ReturnType<typeof parseLedger> {
  if (!existsSync(path)) fail(`${path} not found — run "negplan init" first.`, errorCode);
  let ledger: ReturnType<typeof parseLedger>;
  try {
    ledger = parseLedger(readFileSync(path, "utf8"));
  } catch (e) {
    if (e instanceof LedgerError) fail(`${path}: ${e.message}`, errorCode);
    throw e;
  }
  const { valid, errors } = validateLedger(ledger);
  if (!valid) fail(`${path} failed validation (the gate refuses an invalid ledger):\n  ${errors.join("\n  ")}`, errorCode);
  return ledger;
}

/**
 * Gate a unified diff (stdin) against the ledger's will_implement entries.
 * Exit codes: 0 = every hunk allowed (or no hunks), 1 = hunks held as creep,
 * 2 = usage or ledger error.
 */
async function runGate(file: string): Promise<void> {
  const path = file ?? DEFAULT_LEDGER;
  if (stdin.isTTY) {
    fail("no diff on stdin — pipe a unified diff, e.g. `git diff | negplan gate .negplan.md`", 2);
  }
  const diff = await readStdin();
  const ledger = loadLedger(path, 2);
  const entries = gateDiff(ledger, diff);
  if (entries.length === 0) {
    process.stdout.write("negplan: no hunks found in the diff — nothing to gate.\n");
    return;
  }
  ledger.gates = [...(ledger.gates ?? []), ...entries];
  writeFileSync(path, serializeLedger(ledger), "utf8");

  let creep = 0;
  for (const e of entries) {
    if (e.verdict === "allowed") {
      process.stdout.write(`${e.change_id} ${e.file} ${e.hunk} -> allowed (${e.entry_id})\n`);
    } else {
      creep++;
      process.stdout.write(`${e.change_id} ${e.file} ${e.hunk} -> creep (${creepReason(e)})\n`);
    }
  }
  if (creep > 0) {
    process.stdout.write(
      `negplan: ${entries.length - creep} allowed, ${creep} held as creep — add a will_implement entry for the held hunks (or veto them) and re-gate.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`negplan: ${entries.length} hunk${entries.length === 1 ? "" : "s"} allowed.\n`);
}

interface RenderOptions {
  override?: string;
}

/**
 * Print the veto/allow summary; with --override, write the human's veto
 * overrides back into the ledger first (overridden items move into
 * will_implement).
 */
async function runRender(file: string, opts: RenderOptions): Promise<void> {
  const path = file ?? DEFAULT_LEDGER;
  const ledger = loadLedger(path, 1);
  if (opts.override !== undefined) {
    const ids = opts.override.split(",").map((s) => s.trim()).filter((s) => s !== "");
    if (ids.length === 0) {
      fail(`--override needs at least one will_not_implement id, e.g. --override n1,n2`);
    }
    let result;
    try {
      result = applyOverrides(ledger, ids);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
    writeFileSync(path, serializeLedger(result.ledger), "utf8");
    const note =
      result.already.length > 0
        ? ` (already overridden: ${result.already.join(", ")})`
        : "";
    process.stdout.write(
      `negplan: overrode ${result.applied.join(", ")}${note} — moved into will_implement.\n`,
    );
  }
  process.stdout.write(renderSummary(ledger) + "\n");
}

const program = new Command();

program
  .name("negplan")
  .description("The will-not-implement ledger that gates coding-agent scope creep.")
  .version(VERSION);

program
  .command("init")
  .description("Write a fresh .negplan.md ledger (the plan opens as a will-not-implement list).")
  .option("-t, --task <text>", "the task the agent should work on")
  .option("-o, --output <path>", "ledger file to write", DEFAULT_LEDGER)
  .option("-f, --force", "overwrite an existing ledger")
  .option("--agent <name>", "agent drafting the ledger", "claude-code")
  .action(runInit);

program
  .command("validate")
  .description("Validate a .negplan.md ledger against the ledger schema.")
  .option("-f, --file <path>", "ledger file to validate", DEFAULT_LEDGER)
  .action(runValidate);

program
  .command("gate")
  .description("Gate a unified diff on stdin against the ledger's will_implement entries; hunks citing no entry are held as creep (exit 1).")
  .argument("[file]", "ledger file", DEFAULT_LEDGER)
  .action(runGate);

program
  .command("render")
  .description("Print the veto/allow summary; --override n1,n2 writes human overrides back into the ledger.")
  .argument("[file]", "ledger file", DEFAULT_LEDGER)
  .option("--override <ids>", "comma-separated will_not_implement ids the human overrode")
  .action(runRender);

program.parseAsync().catch((e) => {
  fail(e instanceof Error ? e.message : String(e));
});
