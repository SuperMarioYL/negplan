// src/ledger.ts — the will-not-implement ledger format.
//
// The ledger is a portable markdown file (.negplan.md). YAML frontmatter
// (task, agent, created_at, status) precedes three markdown-table sections:
// will_implement, will_not_implement, gates. This module is the single owner
// of the format: it parses the file into a typed object, serializes it back,
// and validates the parsed object against schemas/ledger.schema.json.
//
// Portability across agents is the moat: the ledger is plain markdown, so any
// agent that can read a file can draft and honor it — no platform API.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { parse as parseYaml } from "yaml";

/** Lifecycle of a ledger. */
export type LedgerStatus = "drafting" | "negotiating" | "gating" | "done";

/** A scope item the agent is allowed to write code for. */
export interface WillImplementEntry {
  id: string; // w1, w2, ...
  summary: string;
  rationale: string;
}

/** A scope item the agent considered and refuses to do, with a justification. */
export interface WillNotImplementEntry {
  id: string; // n1, n2, ...
  summary: string;
  rationale: string;
  overridden: boolean;
}

/** Verdict the gate records for a single diff hunk. */
export type Verdict = "allowed" | "creep" | "overridden";

/** One row in the gates audit log. */
export interface GateEntry {
  change_id: string; // g1, g2, ...
  file: string;
  hunk: string;
  entry_id: string | null; // the will_implement entry this hunk satisfies, or null (creep)
  verdict: Verdict;
  human_override: boolean | null; // true if a human forced it; null when the gate decided alone
}

/** The parsed ledger. */
export interface Ledger {
  task: string;
  agent?: string;
  created_at?: string;
  status: LedgerStatus;
  will_implement: WillImplementEntry[];
  will_not_implement: WillNotImplementEntry[];
  gates: GateEntry[];
  [key: string]: unknown; // frontmatter may carry keys validate() will flag
}

/** A minimal JSON-Schema subset sufficient for the ledger schema. */
export interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  pattern?: string;
  minLength?: number;
  oneOf?: JsonSchema[];
  $ref?: string;
  definitions?: Record<string, JsonSchema>;
  [key: string]: unknown;
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Resolve the package root by walking up from this module to package.json. */
export function packageRoot(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 10 && dir; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return import.meta.dirname;
}

export function schemaPath(): string {
  return join(packageRoot(), "schemas", "ledger.schema.json");
}

export function templatePath(): string {
  return join(packageRoot(), "templates", "ledger.template.md");
}

// --- parsing -----------------------------------------------------------------

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const SECTIONS = ["will_implement", "will_not_implement", "gates"] as const;
type SectionKey = (typeof SECTIONS)[number];

function sectionFor(heading: string): SectionKey | null {
  const h = heading.toLowerCase().replace(/\s+/g, " ").trim();
  if (h.includes("will not implement") || h.includes("will_not_implement")) {
    return "will_not_implement";
  }
  if (h.includes("will implement") || h.includes("will_implement")) {
    return "will_implement";
  }
  if (h === "gates") return "gates";
  return null;
}

function isSeparator(line: string): boolean {
  const s = line.trim();
  if (!s.includes("-")) return false;
  for (const ch of s) {
    if (ch !== "|" && ch !== "-" && ch !== ":" && ch !== " ") return false;
  }
  return s.includes("|");
}

function isTableRow(line: string): boolean {
  return line.trim() !== "" && line.includes("|");
}

/**
 * Split a table row into cells. Markdown's escaped pipe (\|) is honored: the
 * row splits only on unescaped | and each \| unescapes to a literal |, so
 * pipe-bearing cell content survives parsing (and round-trips through
 * serializeLedger, which escapes | on write).
 */
function parseRow(line: string): string[] {
  const raw = line.split(/(?<!\\)\|/);
  if (raw.length && raw[0].trim() === "") raw.shift();
  if (raw.length && raw[raw.length - 1].trim() === "") raw.pop();
  return raw.map((c) => c.trim().replace(/\\\|/g, "|"));
}

function parseBool(s: string | undefined): boolean {
  return (s ?? "").trim().toLowerCase() === "true";
}

function parseNullableBool(s: string | undefined): boolean | null {
  const v = (s ?? "").trim().toLowerCase();
  if (v === "" || v === "null" || v === "none") return null;
  return v === "true";
}

function parseNullableString(s: string | undefined): string | null {
  const v = (s ?? "").trim();
  if (v === "" || v.toLowerCase() === "null" || v.toLowerCase() === "none") {
    return null;
  }
  return v;
}

/** Coerce a YAML-scalar frontmatter value to a string for the typed fields. */
function coerceString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function mapRows(section: SectionKey, rows: string[][]): unknown[] {
  switch (section) {
    case "will_implement":
      return rows.map((r) => ({
        id: r[0] ?? "",
        summary: r[1] ?? "",
        rationale: r[2] ?? "",
      }));
    case "will_not_implement":
      return rows.map((r) => ({
        id: r[0] ?? "",
        summary: r[1] ?? "",
        rationale: r[2] ?? "",
        overridden: parseBool(r[3]),
      }));
    case "gates":
      return rows.map((r) => ({
        change_id: r[0] ?? "",
        file: r[1] ?? "",
        hunk: r[2] ?? "",
        entry_id: parseNullableString(r[3]),
        verdict: (r[4] ?? "creep").trim() || "creep",
        human_override: parseNullableBool(r[5]),
      }));
  }
}

/**
 * Parse a .negplan.md document into a Ledger object.
 * Throws LedgerError if the frontmatter is missing or not valid YAML.
 */
export function parseLedger(content: string): Ledger {
  const fm = FRONTMATTER_RE.exec(content);
  if (!fm) {
    throw new LedgerError(
      "missing YAML frontmatter — a .negplan.md file must start with a --- block",
    );
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parseYaml(fm[1]) as Record<string, unknown>;
  } catch (e) {
    throw new LedgerError(
      `invalid frontmatter YAML: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    parsed = {};
  }

  const body = fm[2];
  const lines = body.split(/\r?\n/);
  const sections: Record<SectionKey, unknown[]> = {
    will_implement: [],
    will_not_implement: [],
    gates: [],
  };

  let i = 0;
  let current: SectionKey | null = null;
  while (i < lines.length) {
    const line = lines[i];
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = sectionFor(heading[1]);
      i++;
      continue;
    }
    if (current && isTableRow(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      i += 2; // consume header + separator
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]) && !isSeparator(lines[i])) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      sections[current] = mapRows(current, rows);
      continue;
    }
    i++;
  }

  const ledger: Ledger = {
    ...parsed,
    task: coerceString(parsed.task) ?? "",
    status: (coerceString(parsed.status) ?? "drafting") as LedgerStatus,
    agent: parsed.agent === undefined ? undefined : coerceString(parsed.agent),
    created_at: parsed.created_at === undefined ? undefined : coerceString(parsed.created_at),
    will_implement: sections.will_implement as WillImplementEntry[],
    will_not_implement: sections.will_not_implement as WillNotImplementEntry[],
    gates: sections.gates as GateEntry[],
  };
  return ledger;
}

// --- serialization -----------------------------------------------------------

/**
 * Quote a string as a YAML double-quoted scalar. The single owner of YAML
 * scalar quoting: anything interpolated into a ledger's frontmatter (init's
 * task/agent, serializeLedger's fields) goes through this, so values
 * containing quotes or backslashes cannot break the document.
 */
export function yamlQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Render a Ledger back into canonical .negplan.md markdown. */
export function serializeLedger(ledger: Ledger): string {
  const fm: string[] = [`task: ${yamlQuote(ledger.task ?? "")}`];
  if (ledger.agent !== undefined) fm.push(`agent: ${yamlQuote(ledger.agent)}`);
  if (ledger.created_at !== undefined) fm.push(`created_at: ${yamlQuote(ledger.created_at)}`);
  fm.push(`status: ${ledger.status ?? "drafting"}`);

  const willImpl = ledger.will_implement ?? [];
  const willNot = ledger.will_not_implement ?? [];
  const gates = ledger.gates ?? [];

  const table = (header: string[], rows: string[][]): string => {
    const sep = header.map(() => "---").join(" | ");
    const lines = [`| ${header.join(" | ")} |`, `| ${sep} |`];
    for (const r of rows) {
      // escape | so a pipe inside a cell cannot split the row on re-parse
      const cells = header.map((_, idx) => (r[idx] ?? "").replaceAll("|", "\\|"));
      lines.push(`| ${cells.join(" | ")} |`);
    }
    return lines.join("\n");
  };

  return [
    "---",
    ...fm,
    "---",
    "",
    "## will_implement",
    "",
    table(["id", "summary", "rationale"], willImpl.map((e) => [e.id, e.summary, e.rationale])),
    "",
    "## will_not_implement",
    "",
    table(
      ["id", "summary", "rationale", "overridden"],
      willNot.map((e) => [e.id, e.summary, e.rationale, String(e.overridden)]),
    ),
    "",
    "## gates",
    "",
    table(
      ["change_id", "file", "hunk", "entry_id", "verdict", "human_override"],
      gates.map((g) => [
        g.change_id,
        g.file,
        g.hunk,
        g.entry_id ?? "null",
        g.verdict,
        g.human_override === null ? "null" : String(g.human_override),
      ]),
    ),
    "",
  ].join("\n");
}

// --- validation (a focused JSON-Schema subset) ------------------------------

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "null":
      return value === null;
    default:
      return true;
  }
}

function resolveRef(ref: string, root: JsonSchema): JsonSchema {
  if (!ref.startsWith("#/")) return {};
  const parts = ref.slice(2).split("/");
  let node: unknown = root;
  for (const p of parts) {
    if (node && typeof node === "object" && p in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[p];
    } else {
      return {};
    }
  }
  return node as JsonSchema;
}

function validateValue(
  value: unknown,
  schema: JsonSchema,
  root: JsonSchema,
  path: string,
  errors: string[],
): void {
  if (schema.$ref) {
    validateValue(value, resolveRef(schema.$ref, root), root, path, errors);
    return;
  }
  if (schema.oneOf) {
    const matched = schema.oneOf.some((branch) => {
      const e2: string[] = [];
      validateValue(value, branch, root, path, e2);
      return e2.length === 0;
    });
    if (!matched) errors.push(`${path || "<root>"}: did not match any allowed type`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path || "<root>"}: must be one of ${schema.enum.map(String).join(", ")}`);
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path || "<root>"}: expected ${types.join("|")}, got ${Array.isArray(value) ? "array" : typeof value}`);
    }
  }
  if (schema.pattern && typeof value === "string") {
    if (!new RegExp(schema.pattern).test(value)) {
      errors.push(`${path || "<root>"}: "${value}" does not match /${schema.pattern}/`);
    }
  }
  if (schema.minLength !== undefined && typeof value === "string" && value.length < schema.minLength) {
    errors.push(`${path || "<root>"}: must be at least ${schema.minLength} characters`);
  }
  if (matchesType(value, "object")) {
    const obj = value as Record<string, unknown>;
    if (schema.required) {
      for (const r of schema.required) {
        if (!(r in obj)) errors.push(`${path || "<root>"}: missing required property "${r}"`);
      }
    }
    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in obj) validateValue(obj[k], sub, root, `${path}.${k}`, errors);
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set<string>([
        ...(schema.required ?? []),
        ...Object.keys(schema.properties ?? {}),
      ]);
      for (const k of Object.keys(obj)) {
        if (!allowed.has(k)) errors.push(`${path || "<root>"}: additional property "${k}" is not allowed`);
      }
    }
  }
  if (matchesType(value, "array") && schema.items) {
    const arr = value as unknown[];
    for (let idx = 0; idx < arr.length; idx++) {
      validateValue(arr[idx], schema.items, root, `${path}[${idx}]`, errors);
    }
  }
}

/** Load the ledger JSON schema from schemas/ledger.schema.json. */
export function loadSchema(): JsonSchema {
  const raw = readFileSync(schemaPath(), "utf8");
  return JSON.parse(raw) as JsonSchema;
}

/** Validate a parsed Ledger against the ledger schema. */
export function validateLedger(ledger: unknown, schema?: JsonSchema): ValidationResult {
  const root = schema ?? loadSchema();
  const errors: string[] = [];
  validateValue(ledger, root, root, "", errors);
  return { valid: errors.length === 0, errors };
}
