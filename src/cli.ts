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
  templatePath,
  packageRoot,
  LedgerError,
} from "./ledger.js";
import { gateDiff } from "./gate.js";
import { renderSummary } from "./render.js";

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

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function fail(message: string): never {
  process.stderr.write(`negplan: ${message}\n`);
  process.exit(1);
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

function runGate(file?: string): void {
  const path = file ?? DEFAULT_LEDGER;
  try {
    if (!existsSync(path)) fail(`${path} not found — run "negplan init" first.`);
    const ledger = parseLedger(readFileSync(path, "utf8"));
    gateDiff(ledger, ""); // m2 stub — throws
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stdout.write(`negplan: ${msg}\n`);
    process.exit(0);
  }
}

function runRender(file?: string): void {
  const path = file ?? DEFAULT_LEDGER;
  try {
    if (!existsSync(path)) fail(`${path} not found — run "negplan init" first.`);
    const ledger = parseLedger(readFileSync(path, "utf8"));
    process.stdout.write(renderSummary(ledger) + "\n"); // m3 stub — throws
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stdout.write(`negplan: ${msg}\n`);
    process.exit(0);
  }
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
  .description("Gate a diff's hunks against allowed ledger entries (milestone m2).")
  .argument("[file]", "ledger file", DEFAULT_LEDGER)
  .action(runGate);

program
  .command("render")
  .description("Print a veto/allow summary + override panel (milestone m3).")
  .argument("[file]", "ledger file", DEFAULT_LEDGER)
  .action(runRender);

program.parseAsync().catch((e) => {
  fail(e instanceof Error ? e.message : String(e));
});
