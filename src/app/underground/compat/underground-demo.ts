/**
 * @deprecated 废弃候选（T4-1 / ADR-0025 deep 一期）— ② 确定性编排主线（线性函数式编排）。
 *
 * 替代物：src/app/deep/* DeepRuntime（manager 自由决策循环 → 一层 child 探索 → 父层综合）；
 * 正式入口 POST /api/deep/conversations + /api/deep/conversations/:id/runs。
 *
 * 删除前置条件（闭环4 §8.1 阶段④）：smoke/tests 迁移完成 + 等价能力验证通过 + 无活跃引用。
 * 当前保持运行不阻塞构建；禁止改名/删除（仍被 test/smoke/compat 引用）。
 * 边界：domain/underground 的 AgentLoop/Guard/run tree/事件契约为保留复用抽象，不在退役范围。
 */
import { runUndergroundDirectionSessionWithIntelligence } from "./underground-direction-session.js";
import { recoverUndergroundDirectionSession } from "./underground-direction-recovery.js";
import { createUndergroundDemoSummary } from "./underground-demo-summary.js";
import {
  createUndergroundAiRuntimeConfig,
  createUndergroundAiDisabledConfigurationError,
  UndergroundAiConfigurationError,
  type UndergroundAiMode,
} from "../../underground-ai-runtime.js";
import { createResearchEnabledToolCenter } from "../../research/research-tool-contribution.js";

const DEFAULT_GOAL = "Build a small deterministic helper.";

await main();

async function main(): Promise<void> {
  try {
    const args = parseUndergroundDemoArgs(process.argv.slice(2));
    const aiConfig = createUndergroundAiRuntimeConfig({ mode: args.aiMode });
    if (!aiConfig.enabled) {
      throw createUndergroundAiDisabledConfigurationError(aiConfig.summaryInput);
    }
    const result = await runUndergroundDirectionSessionWithIntelligence(args.goal, {
      outputDirectory: args.outputDirectory,
      createIntelligenceChannel: aiConfig.createIntelligenceChannel,
      createToolCenter: (runtime) => createResearchEnabledToolCenter({ runtime }),
    });
    const recovery =
      args.autoAnswer && result.terminalStatus === "awaiting_user"
        ? recoverUndergroundDirectionSession(result)
        : undefined;
    const summary = createUndergroundDemoSummary(result, recovery, aiConfig.summaryInput);

    console.log("AgentArbor underground-only demo");
    console.log("");
    console.log("Goal:");
    console.log(args.goal);

    console.log("");
    console.log("AI:");
    console.log(summary.ai.enabled ? `${summary.ai.mode} (${summary.ai.status})` : "disabled");

    console.log("");
    console.log("EventLog replay:");
    for (const entry of result.runtime.eventLog.list()) {
      console.log(`${String(entry.sequence).padStart(2, "0")}. ${entry.type}`);
    }

    console.log("");
    console.log("Summary:");
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    if (error instanceof UndergroundAiConfigurationError) {
      const configurationSummary = {
        ai: {
          ...error.issue.summaryInput,
          status: "configuration_failed",
          eventCounts: {
            requested: 0,
            completed: 0,
            failed: 0,
          },
          aiCandidateCount: 0,
          fallbackCount: 0,
          aiFallbackUsed: false,
          rootletKinds: [],
          modelCallRefs: [],
          configurationError: {
            code: error.issue.code,
            message: error.issue.message,
          },
        },
      };
      console.error("AgentArbor underground-only demo configuration error");
      console.error(error.issue.message);
      console.error(JSON.stringify(configurationSummary, null, 2));
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

function parseUndergroundDemoArgs(argv: readonly string[]): {
  goal: string;
  autoAnswer: boolean;
  outputDirectory?: string;
  aiMode: UndergroundAiMode;
} {
  const goalParts: string[] = [];
  let autoAnswer = false;
  let outputDirectory: string | undefined;
  let aiMode: UndergroundAiMode = "fake";

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
    if (arg === "--ai") {
      const next = argv[index + 1];
      if (next === undefined || next.trim() === "") {
        throw new Error("--ai requires one of: fake, openai-compatible.");
      }
      aiMode = parseAiMode(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--ai=")) {
      aiMode = parseAiMode(arg.slice("--ai=".length));
      continue;
    }
    goalParts.push(arg);
  }

  return {
    goal: goalParts.join(" ").trim() || DEFAULT_GOAL,
    autoAnswer,
    outputDirectory,
    aiMode,
  };
}

function parseAiMode(value: string): UndergroundAiMode {
  if (value === "fake" || value === "openai-compatible") {
    return value;
  }
  throw new Error("--ai requires one of: fake, openai-compatible.");
}
