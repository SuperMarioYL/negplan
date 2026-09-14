import {readFileSync} from "node:fs";
import {parseLedger, validateLedger, serializeLedger} from "../dist/src/ledger.js";
import {gateDiff} from "../dist/src/gate.js";
import {applyOverrides, renderSummary} from "../dist/src/render.js";

// m1 flow: parse, validate and round-trip the complete example ledger.
const ledger = parseLedger(readFileSync("examples/example-ledger.md", "utf8"));
console.log(JSON.stringify({task:ledger.task, will_implement:ledger.will_implement.length, will_not_implement:ledger.will_not_implement.length, validation:validateLedger(ledger)}, null, 2));
const roundtrip = parseLedger(serializeLedger(ledger));
console.log("roundtrip valid:", validateLedger(roundtrip).valid);
console.log(JSON.stringify(validateLedger({...ledger,status:"unexpected"}), null, 2));

// m2 flow: gate a diff with one cited hunk and one uncited hunk.
const diff = [
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
const verdicts = gateDiff(ledger, diff);
console.log("gate verdicts:", verdicts.map(g => `${g.file} ${g.hunk} -> ${g.verdict}${g.entry_id ? ` (${g.entry_id})` : ""}`));

// m3 flow: the human overrides one veto, then render the summary.
const {ledger: negotiated} = applyOverrides(ledger, ["n2"]);
negotiated.gates = verdicts;
console.log(renderSummary(negotiated));
