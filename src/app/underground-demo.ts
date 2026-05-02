import { runUndergroundDirectionSession } from "./underground-direction-session.js";
import { createUndergroundDemoSummary } from "./underground-demo-summary.js";

const DEFAULT_GOAL = "Build a small deterministic helper.";

const goal = process.argv.slice(2).join(" ").trim() || DEFAULT_GOAL;
const result = runUndergroundDirectionSession(goal);
const summary = createUndergroundDemoSummary(result);

console.log("AgentArbor underground-only demo");
console.log("");
console.log("Goal:");
console.log(goal);

console.log("");
console.log("EventLog replay:");
for (const entry of result.runtime.eventLog.list()) {
  console.log(`${String(entry.sequence).padStart(2, "0")}. ${entry.type}`);
}

console.log("");
console.log("Summary:");
console.log(JSON.stringify(summary, null, 2));
