import {readFileSync} from "node:fs";
import {parseLedger, validateLedger, serializeLedger} from "../dist/src/ledger.js";
const ledger = parseLedger(readFileSync("examples/example-ledger.md", "utf8"));
console.log(JSON.stringify({task:ledger.task, will_implement:ledger.will_implement.length, will_not_implement:ledger.will_not_implement.length, validation:validateLedger(ledger)}, null, 2));
const roundtrip = parseLedger(serializeLedger(ledger));
console.log("roundtrip valid:", validateLedger(roundtrip).valid);
console.log(JSON.stringify(validateLedger({...ledger,status:"unexpected"}), null, 2));
