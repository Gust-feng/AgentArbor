import type { ArborMessageType } from "../../../domain/common.js";
import type { IntelligenceChannel, ModelOutputDelta } from "../../../domain/intelligence/contracts.js";
import type { TaskSoil } from "../../../domain/soil/task-soil.js";
import type { ToolExecutionBroker } from "../../../domain/tools/contracts.js";
import type { AgentRunTree } from "../../../domain/underground/agent-fabric.js";
import type { ArtifactRecord } from "../../../kernel/artifacts/in-memory-artifact-store.js";
import type {
  UndergroundAiEnvironment,
  UndergroundAiMode,
  UndergroundAiProviderFetch,
} from "../../underground-ai-runtime.js";
import type { MinimalRuntime } from "../../runtime.js";
import type { DesktopTaskSoilInput } from "../../task-soil/task-soil-workspace.js";

export type CognitiveWorkSessionStatus = "completed" | "stopped" | "awaiting_user" | "failed";

export type WorkSessionDecisionAction =
  | "direct_answer"
  | "use_tools"
  | "spawn_children"
  | "wait_children"
  | "synthesize"
  | "ask_user"
  | "produce_artifact"
  | "stop";

export type CognitiveWorkSessionReport = {
  readonly title: string;
  readonly keyFindings: readonly string[];
  readonly recommendations: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly uncertainty: readonly string[];
  readonly nextActions: readonly string[];
  readonly decisionSummary: string;
  readonly confidence: number;
};

export type CognitiveWorkSessionDirectAnswer = {
  readonly answer: string;
  readonly evidenceRefs: readonly string[];
  readonly uncertainty: readonly string[];
  readonly followUpSuggestions: readonly string[];
  readonly decisionSummary: string;
  readonly confidence: number;
};

export type CognitiveWorkSessionStep = {
  readonly stepId: string;
  readonly stepIndex: number;
  readonly action: WorkSessionDecisionAction;
  readonly status: "completed" | "stopped" | "failed" | "skipped";
  readonly summary: string;
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly childRunIds: readonly string[];
  readonly synthesisId?: string;
  readonly createdAt: string;
};

export type CognitiveWorkSessionResult = {
  readonly status: CognitiveWorkSessionStatus;
  readonly traceId: string;
  readonly goalId: string;
  readonly runtime: MinimalRuntime;
  readonly taskSoil: TaskSoil;
  readonly agentRunTree: AgentRunTree;
  readonly finalArtifact?: ArtifactRecord;
  readonly report?: CognitiveWorkSessionReport;
  readonly directAnswer?: CognitiveWorkSessionDirectAnswer;
  readonly openQuestions: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly uncertainty: readonly string[];
  readonly nextActions: readonly string[];
  readonly steps: readonly CognitiveWorkSessionStep[];
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
  readonly eventTypes: readonly ArborMessageType[];
};

export type CognitiveWorkSessionRuntimeContext = {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
};

export type RunCognitiveWorkSessionOptions = {
  readonly aiMode?: UndergroundAiMode;
  readonly aiEnvironment?: UndergroundAiEnvironment;
  readonly providerFetch?: UndergroundAiProviderFetch;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly runtime?: MinimalRuntime;
  readonly createIntelligenceChannel?: (runtime: MinimalRuntime) => IntelligenceChannel;
  readonly createToolCenter?: (runtime: MinimalRuntime) => ToolExecutionBroker;
  readonly onRuntimeReady?: (context: CognitiveWorkSessionRuntimeContext) => void;
  readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
  readonly stepLimit?: number;
  readonly maxChildRuns?: number;
};

export type WorkSessionDecision = {
  readonly action: WorkSessionDecisionAction;
  readonly childSpecs: readonly WorkSessionChildSpecRequest[];
  readonly decisionSummary: string;
  readonly uncertainty: string;
  readonly confidence: number;
};

export type WorkSessionChildSpecRequest = {
  readonly specId: string;
  readonly displayName: string;
  readonly role: string;
  readonly objective: string;
  readonly allowedTools: readonly string[];
  readonly inputRefs: readonly string[];
};

export type WorkSessionChildMaterial = {
  readonly summary: string;
  readonly findings: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly uncertainty: string;
  readonly confidence: number;
};

export const WORK_SESSION_ALLOWED_TOOLS = ["search", "read"] as const;
