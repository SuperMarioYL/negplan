// test/version.test.ts — every version surface must agree on one number.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { packageRoot } from "../src/ledger.js";

const VERSION = "0.3.0";

test("package.json, the VERSION file and the CHANGELOG agree on the version", () => {
  const pkg = JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf8"));
  assert.equal(pkg.version, VERSION);
  assert.equal(readFileSync(join(packageRoot(), "VERSION"), "utf8").trim(), VERSION);
  const changelog = readFileSync(join(packageRoot(), "CHANGELOG.md"), "utf8");
  assert.ok(changelog.includes(`## [${VERSION}]`), "CHANGELOG must carry the current version section");
  assert.ok(changelog.includes(`[${VERSION}]: https://github.com/SuperMarioYL/negplan/releases/tag/v${VERSION}`));
});

test("the CLI --version reports the same version", () => {
  const out = execFileSync(
    process.execPath,
    [join(packageRoot(), "dist", "src", "cli.js"), "--version"],
    { encoding: "utf8" },
  );
  assert.ok(out.includes(VERSION), `--version output must contain ${VERSION}: ${out.trim()}`);
});
