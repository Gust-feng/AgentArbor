import { runUndergroundDirectionSession } from "./underground-direction-session.js";
import { recoverUndergroundDirectionSession } from "./underground-direction-recovery.js";
import { createUndergroundDemoSummary } from "./underground-demo-summary.js";

const DEFAULT_GOAL = "Build a small deterministic helper.";

const args = parseUndergroundDemoArgs(process.argv.slice(2));
const result = runUndergroundDirectionSession(args.goal, { outputDirectory: args.outputDirectory });
const recovery =
  args.autoAnswer && result.terminalStatus === "awaiting_user"
    ? recoverUndergroundDirectionSession(result)
    : undefined;
const summary = createUndergroundDemoSummary(result, recovery);

console.log("AgentArbor underground-only demo");
console.log("");
console.log("Goal:");
console.log(args.goal);

console.log("");
console.log("EventLog replay:");
for (const entry of result.runtime.eventLog.list()) {
  console.log(`${String(entry.sequence).padStart(2, "0")}. ${entry.type}`);
}

console.log("");
console.log("Summary:");
console.log(JSON.stringify(summary, null, 2));

function parseUndergroundDemoArgs(argv: readonly string[]): {
  goal: string;
  autoAnswer: boolean;
  outputDirectory?: string;
} {
  const goalParts: string[] = [];
  let autoAnswer = false;
  let outputDirectory: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--auto-answer") {
      autoAnswer = true;
      continue;
    }
    if (arg === "--out") {
      const next = argv[index + 1];
      if (next === undefined || next.trim() === "") {
        throw new Error("--out requires an explicit output directory.");
      }
      outputDirectory = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      const value = arg.slice("--out=".length);
      if (value.trim() === "") {
        throw new Error("--out requires an explicit output directory.");
      }
      outputDirectory = value;
      continue;
    }
    goalParts.push(arg);
  }

  return {
    goal: goalParts.join(" ").trim() || DEFAULT_GOAL,
    autoAnswer,
    outputDirectory,
  };
}
