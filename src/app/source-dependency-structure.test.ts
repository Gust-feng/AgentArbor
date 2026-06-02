import assert from "node:assert/strict";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

type SourceGraph = ReadonlyMap<string, readonly string[]>;

const SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;
const IMPORT_SPECIFIER_PATTERN =
  /(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g;

test("app and domain source dependencies do not form local cycles", async () => {
  for (const area of ["src/app", "src/domain"]) {
    const graph = await buildSourceGraph(area);
    const cycles = findDependencyCycles(graph, 10);

    assert.deepEqual(cycles, [], `${area} should not contain local import cycles`);
  }
});

test("domain internals avoid sibling barrel imports", async () => {
  const files = await collectSourceFiles(path.join(process.cwd(), "src", "domain"));
  const violations: string[] = [];

  for (const file of files) {
    if (path.basename(file) === "index.ts") {
      continue;
    }

    const source = await fs.readFile(file, "utf8");
    for (const specifier of importSpecifiersFrom(source)) {
      if (isSiblingBarrelImport(specifier)) {
        violations.push(`${relativePath(file)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, [], "domain implementation files should import sibling contracts directly");
});

test("domain and kernel do not depend on app or adapters", async () => {
  const root = process.cwd();
  const files = [
    ...(await collectSourceFiles(path.join(root, "src", "domain"))),
    ...(await collectSourceFiles(path.join(root, "src", "kernel"))),
  ];
  const violations: string[] = [];

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    for (const target of resolveRelativeImports(file, source)) {
      const targetPath = relativePath(target);
      if (targetPath.startsWith("src/app/") || targetPath.startsWith("src/adapters/")) {
        violations.push(`${relativePath(file)} -> ${targetPath}`);
      }
    }
  }

  assert.deepEqual(violations, [], "domain/kernel layers must not import app or adapters");
});

test("kernel tool use loop keeps execution helpers split", async () => {
  const [loop, contracts, execution, messages, results, cloning] = await Promise.all([
    readSource(path.join(process.cwd(), "src", "kernel", "intelligence", "tool-use-loop.ts")),
    readSource(path.join(process.cwd(), "src", "kernel", "intelligence", "tool-use-loop-contracts.ts")),
    readSource(path.join(process.cwd(), "src", "kernel", "intelligence", "tool-use-loop-execution.ts")),
    readSource(path.join(process.cwd(), "src", "kernel", "intelligence", "tool-use-loop-messages.ts")),
    readSource(path.join(process.cwd(), "src", "kernel", "intelligence", "tool-use-loop-results.ts")),
    readSource(path.join(process.cwd(), "src", "kernel", "intelligence", "tool-use-loop-cloning.ts")),
  ]);

  assert.equal(loop.includes('from "./tool-use-loop-contracts.js"'), true);
  assert.equal(loop.includes('from "./tool-use-loop-execution.js"'), true);
  assert.equal(loop.includes('from "./tool-use-loop-messages.js"'), true);
  assert.equal(loop.includes('from "./tool-use-loop-results.js"'), true);
  assert.equal(loop.includes('from "./tool-use-loop-cloning.js"'), true);
  assert.equal(loop.includes("export type ToolUseLoopOptions ="), false);
  assert.equal(loop.includes("function executeToolCalls"), false);
  assert.equal(loop.includes("function executeToolCallSafely"), false);
  assert.equal(loop.includes("function canExecuteReadOnlyBatchInParallel"), false);
  assert.equal(loop.includes("function assistantToolCallMessage"), false);
  assert.equal(loop.includes("function toolResultMessage"), false);
  assert.equal(loop.includes("function outOfFuelLoopResult"), false);
  assert.equal(loop.includes("function abortedLoopResult"), false);
  assert.equal(loop.includes("function approvalRequiredResultFromPending"), false);
  assert.equal(loop.includes("function clonePendingApproval"), false);
  assert.equal(contracts.includes("export type ToolUseLoopOptions"), true);
  assert.equal(execution.includes("export async function executeToolCalls"), true);
  assert.equal(execution.includes("export async function executeSingleToolCall"), true);
  assert.equal(messages.includes("export function assistantToolCallMessage"), true);
  assert.equal(messages.includes("export function toolResultMessage"), true);
  assert.equal(results.includes("export function outOfFuelLoopResult"), true);
  assert.equal(results.includes("export function abortedLoopResult"), true);
  assert.equal(results.includes("export function approvalRequiredResultFromPending"), true);
  assert.equal(cloning.includes("export function clonePendingApproval"), true);
});

test("OpenAI Responses provider keeps protocol mapping split", async () => {
  const [provider, request, response, fetchBridge] = await Promise.all([
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "openai-responses-provider.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "openai-responses-request.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "openai-responses-response.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "openai-fetch-bridge.ts")),
  ]);

  assert.equal(provider.includes('from "./openai-responses-request.js"'), true);
  assert.equal(provider.includes('from "./openai-responses-response.js"'), true);
  assert.equal(provider.includes('from "./openai-fetch-bridge.js"'), true);
  assert.equal(provider.includes("function buildResponsesRequestBody"), false);
  assert.equal(provider.includes("function buildInput"), false);
  assert.equal(provider.includes("function normalizeResponse"), false);
  assert.equal(provider.includes("function normalizeStreamResponse"), false);
  assert.equal(provider.includes("function parseOutputItems"), false);
  assert.equal(provider.includes("function toOpenAIFetch"), false);
  assert.equal(provider.includes("openai-compatible-chat-completions-provider.js"), false);
  assert.equal(request.includes("export function buildResponsesRequestBody"), true);
  assert.equal(response.includes("export function normalizeOpenAIResponsesResponse"), true);
  assert.equal(response.includes("export async function normalizeOpenAIResponsesStreamResponse"), true);
  assert.equal(fetchBridge.includes("export function toOpenAIFetch"), true);
});

test("OpenAI-compatible Chat provider keeps request mapping split", async () => {
  const [provider, request, response, stream] = await Promise.all([
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "openai-compatible-chat-completions-provider.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "openai-compatible-chat-request.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "openai-compatible-chat-response.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "openai-compatible-chat-stream.ts")),
  ]);

  assert.equal(provider.includes('from "./openai-compatible-chat-request.js"'), true);
  assert.equal(provider.includes('from "./openai-compatible-chat-response.js"'), true);
  assert.equal(provider.includes('from "./openai-compatible-chat-stream.js"'), true);
  assert.equal(provider.includes("buildOpenAICompatibleChatRequestBody"), true);
  assert.equal(provider.includes("function toOpenAIMessage"), false);
  assert.equal(provider.includes("function toOpenAITool"), false);
  assert.equal(provider.includes("function toOpenAIToolChoice"), false);
  assert.equal(provider.includes("function toOpenAIToolCall"), false);
  assert.equal(provider.includes("applyOpenAICompatibleChatRequestPolicy"), false);
  assert.equal(provider.includes("buildOpenAIChatCompletionsControlFields"), false);
  assert.equal(provider.includes("function normalizeOpenAICompatibleResponse"), false);
  assert.equal(provider.includes("async function normalizeOpenAICompatibleStreamResponse"), false);
  assert.equal(provider.includes("function emitReasoningDelta"), false);
  assert.equal(provider.includes("function accumulateStreamingToolCalls"), false);
  assert.equal(provider.includes("function parseToolCalls"), false);
  assert.equal(provider.includes("function assistantContinuationMessage"), false);
  assert.equal(request.includes("export function buildOpenAICompatibleChatRequestBody"), true);
  assert.equal(request.includes("function toOpenAIMessage"), true);
  assert.equal(request.includes("function toOpenAITool"), true);
  assert.equal(request.includes("function toOpenAIToolChoice"), true);
  assert.equal(request.includes("function toOpenAIToolCall"), true);
  assert.equal(response.includes("export function normalizeOpenAICompatibleResponse"), true);
  assert.equal(response.includes("export function parseToolCalls"), true);
  assert.equal(response.includes("function assistantContinuationMessage"), true);
  assert.equal(stream.includes("export async function normalizeOpenAICompatibleStreamResponse"), true);
  assert.equal(stream.includes("function emitReasoningDelta"), true);
  assert.equal(stream.includes("function accumulateStreamingToolCalls"), true);
});

test("Fake model provider keeps fixture families split", async () => {
  const [provider, contracts, output, desktop, underground, stream] = await Promise.all([
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "fake-model-provider.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "fake-model-provider-contracts.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "fake-model-provider-output.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "fake-model-provider-desktop.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "fake-model-provider-underground.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "fake-model-provider-stream.ts")),
  ]);

  assert.equal(provider.includes('from "./fake-model-provider-contracts.js"'), true);
  assert.equal(provider.includes('from "./fake-model-provider-output.js"'), true);
  assert.equal(provider.includes('from "./fake-model-provider-stream.js"'), true);
  assert.equal(provider.includes("function defaultFakeOutput"), false);
  assert.equal(provider.includes("function fakeDesktopIntentGateOutput"), false);
  assert.equal(provider.includes("function fakeWorkSessionDecisionOutput"), false);
  assert.equal(provider.includes("function fakeIntentProfileOutput"), false);
  assert.equal(provider.includes("function fakeConvergenceJudgmentOutput"), false);
  assert.equal(provider.includes("function emitFakeOutputDeltas"), false);
  assert.equal(contracts.includes("export type FakeModelProviderOptions"), true);
  assert.equal(contracts.includes("export type FakeModelProviderResponse"), true);
  assert.equal(output.includes("export function defaultFakeStep"), true);
  assert.equal(output.includes("export function defaultFakeOutput"), true);
  assert.equal(output.includes('from "./fake-model-provider-desktop.js"'), true);
  assert.equal(output.includes('from "./fake-model-provider-underground.js"'), true);
  assert.equal(desktop.includes("export function fakeDesktopAgentStep"), true);
  assert.equal(desktop.includes("export function fakeWorkSessionSynthesisOutput"), true);
  assert.equal(underground.includes("export function fakeIntentProfileOutput"), true);
  assert.equal(underground.includes("export function fakeConvergenceJudgmentOutput"), true);
  assert.equal(stream.includes("export function emitFakeOutputDeltas"), true);
});

test("Underground orchestrator keeps run factories split", async () => {
  const [orchestrator, factories] = await Promise.all([
    readSource(path.join(process.cwd(), "src", "app", "underground", "orchestrator.ts")),
    readSource(path.join(process.cwd(), "src", "app", "underground", "orchestrator-factories.ts")),
  ]);

  assert.equal(orchestrator.includes('from "./orchestrator-factories.js"'), true);
  assert.equal(orchestrator.includes("function createManagerAgentSpec"), false);
  assert.equal(orchestrator.includes("function createRootletChildRuns"), false);
  assert.equal(orchestrator.includes("function createDelegationDecisionFromGrowth"), false);
  assert.equal(orchestrator.includes("function createParentSynthesisFromCandidatePool"), false);
  assert.equal(orchestrator.includes("function createExplorationPlanFromAutonomyDecision"), false);
  assert.equal(orchestrator.includes("function createExplorationCycle"), false);
  assert.equal(orchestrator.includes("function createAutonomyReview"), false);
  assert.equal(factories.includes("export const UNDERGROUND_CENTER_MANAGER_AGENT_ID"), true);
  assert.equal(factories.includes("export function createManagerAgentSpec"), true);
  assert.equal(factories.includes("export function createRootletChildRuns"), true);
  assert.equal(factories.includes("export function createDelegationDecisionFromGrowth"), true);
  assert.equal(factories.includes("export function createParentSynthesisFromCandidatePool"), true);
  assert.equal(factories.includes("export function createExplorationPlanFromAutonomyDecision"), true);
  assert.equal(factories.includes("export function createExplorationCycle"), true);
  assert.equal(factories.includes("export function createAutonomyReview"), true);
});

async function buildSourceGraph(area: string): Promise<SourceGraph> {
  const root = process.cwd();
  const sourceRoot = path.join(root, area);
  const files = await collectSourceFiles(sourceRoot);
  const fileSet = new Set(files);
  const graph = new Map<string, string[]>();

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    graph.set(file, resolveRelativeImports(file, source).filter((target) => fileSet.has(target)));
  }

  return graph;
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(fullPath)));
    } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name) as (typeof SOURCE_EXTENSIONS)[number])) {
      files.push(fullPath);
    }
  }

  return files;
}

async function readSource(file: string): Promise<string> {
  return fs.readFile(file, "utf8");
}

function resolveRelativeImports(file: string, source: string): string[] {
  const targets: string[] = [];
  for (const specifier of importSpecifiersFrom(source)) {
    if (!specifier.startsWith(".")) {
      continue;
    }

    const target = resolveSourceSpecifier(file, specifier);
    if (target !== undefined) {
      targets.push(target);
    }
  }

  return targets;
}

function importSpecifiersFrom(source: string): string[] {
  return [...source.matchAll(IMPORT_SPECIFIER_PATTERN)].map((match) => match[1]);
}

function isSiblingBarrelImport(specifier: string): boolean {
  return /^(\.\.\/|\.\/)[^/]+\/index\.js$/.test(specifier);
}

function resolveSourceSpecifier(file: string, specifier: string): string | undefined {
  const withoutJsExtension = path
    .resolve(path.dirname(file), specifier)
    .replace(/\.js$/, "");
  const candidates = [
    `${withoutJsExtension}.ts`,
    `${withoutJsExtension}.tsx`,
    path.join(withoutJsExtension, "index.ts"),
    path.join(withoutJsExtension, "index.tsx"),
  ];

  return candidates.find((candidate) => fileExistsSync(candidate));
}

function fileExistsSync(file: string): boolean {
  return existsSync(file);
}

function findDependencyCycles(graph: SourceGraph, maxLength: number): string[][] {
  const cycles = new Map<string, string[]>();

  for (const start of graph.keys()) {
    const stack = [start];
    const visited = new Set([start]);

    searchDependencyCycles(start, start, stack, visited, graph, cycles, maxLength);
  }

  return [...cycles.values()].sort(compareCycle);
}

function searchDependencyCycles(
  start: string,
  current: string,
  stack: string[],
  visited: Set<string>,
  graph: SourceGraph,
  cycles: Map<string, string[]>,
  maxLength: number
): void {
  if (stack.length > maxLength) {
    return;
  }

  for (const next of graph.get(current) ?? []) {
    if (next === start && stack.length > 1) {
      const cycle = canonicalCycle(stack.map(relativePath));
      cycles.set(cycle.join(" -> "), cycle);
      continue;
    }

    if (visited.has(next)) {
      continue;
    }

    visited.add(next);
    stack.push(next);
    searchDependencyCycles(start, next, stack, visited, graph, cycles, maxLength);
    stack.pop();
    visited.delete(next);
  }
}

function canonicalCycle(cycle: string[]): string[] {
  let best = cycle;
  for (let index = 1; index < cycle.length; index += 1) {
    const rotated = [...cycle.slice(index), ...cycle.slice(0, index)];
    if (rotated.join("\n") < best.join("\n")) {
      best = rotated;
    }
  }

  return best;
}

function compareCycle(left: string[], right: string[]): number {
  return left.length - right.length || left.join("").localeCompare(right.join(""));
}

function relativePath(file: string): string {
  return path.relative(process.cwd(), file).replaceAll(path.sep, "/");
}
