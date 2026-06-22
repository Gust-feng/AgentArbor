import assert from "node:assert/strict";
import test from "node:test";
import type { BasicAgentRun, RunEvent } from "../../domain/basic-agent/index.js";
import type { ToolResultEnvelope } from "../../domain/tools/index.js";
import { createDesktopWorkSessionReadModel } from "./work-session.js";
import { transcriptNodesFromRunEvents } from "./work-session-transcript.js";

test("work session read model keeps ordinary completed answers separate from deliverables", () => {
  const run = basicRun("completed");
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [event(run.runId, "final.result", "结果已生成", "completed")],
    canvas: {
      kind: "desktop_agent_canvas",
      taskSoil: {
        taskSoilId: "soil-test",
        goalSummary: "总结 notes.md",
        contextRefs: [{ ref: "file:notes.md", kind: "file", summary: "文件引用" }],
        permissionBoundaryRefs: ["read:file:notes.md"],
      },
      agent: {
        status: "completed",
        answer: {
          answer: "这是总结结果。",
          modelCallRefs: ["model-call-1"],
          toolCallRefs: ["tool-call-1"],
          evidenceRefs: ["tool:tool-call-1"],
          resultBlocks: [],
        },
        modelCallRefs: ["model-call-1"],
        toolCallRefs: ["tool-call-1"],
        activity: [],
      },
      explanation: {
        resultWhyReasonable: "safe",
        observationPanelRole: "safe",
      },
    },
    toolDisplays: [{
      kind: "generic_tool_summary",
      summary: "文件已读取。",
      items: ["notes.md"],
    }],
  });

  assert.equal(workSession.stage, "completed");
  assert.equal(workSession.answer?.content, "这是总结结果。");
  assert.equal(workSession.deliverable, undefined);
  assert.equal(workSession.contextAttachments[0]?.ref, "file:notes.md");
  assert.equal(workSession.contextLedger.entries.some((entry) => entry.kind === "attachment"), true);
  assert.equal(workSession.contextLedger.entries.some((entry) => entry.kind === "tool_evidence"), true);
  assert.equal(workSession.safetySummary.summary, "上下文 1；证据 1");
  assert.equal(JSON.stringify(workSession).includes("普通视图"), false);
  assert.equal(JSON.stringify(workSession).includes("模型输入"), false);
});

test("desktop work view read model does not re-expose the legacy workSession alias", () => {
  const run = basicRun("completed");
  const workView = createDesktopWorkSessionReadModel({
    run,
    events: [event(run.runId, "final.result", "结果已生成", "completed")],
    canvas: {
      kind: "desktop_agent_canvas",
      taskSoil: {
        taskSoilId: "soil-work-view-boundary",
        goalSummary: "总结 notes.md",
        contextRefs: [],
        permissionBoundaryRefs: [],
      },
      agent: {
        status: "completed",
        answer: {
          answer: "这是总结结果。",
          modelCallRefs: ["model-call-1"],
          toolCallRefs: [],
          evidenceRefs: [],
          resultBlocks: [],
        },
        modelCallRefs: ["model-call-1"],
        toolCallRefs: [],
        activity: [],
      },
      explanation: {
        resultWhyReasonable: "safe",
        observationPanelRole: "safe",
      },
    },
  });

  assert.equal(Object.hasOwn(workView, "workSession"), false);
  assert.equal(Object.hasOwn(workView, "canvas"), false);
  assert.equal(workView.answer?.content, "这是总结结果。");
});
test("work session read model does not truncate ordinary answers before the chat turn", () => {
  const run = basicRun("completed");
  const longAnswer = `开头\n${"模型正文。".repeat(420)}\n结尾`;
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [event(run.runId, "final.result", "结果已生成", "completed")],
    canvas: {
      kind: "desktop_agent_canvas",
      taskSoil: {
        taskSoilId: "soil-long-answer",
        goalSummary: "输出长回答",
        contextRefs: [],
        permissionBoundaryRefs: [],
      },
      agent: {
        status: "completed",
        answer: {
          answer: longAnswer,
          modelCallRefs: ["model-call-1"],
          toolCallRefs: [],
          evidenceRefs: [],
          resultBlocks: [],
        },
        modelCallRefs: ["model-call-1"],
        toolCallRefs: [],
        activity: [],
      },
      explanation: {
        resultWhyReasonable: "safe",
        observationPanelRole: "safe",
      },
    },
  });

  assert.equal(workSession.answer?.content, longAnswer);
});

test("work session read model exposes triggered skills without leaking skill body", () => {
  const run = basicRun("completed");
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [event(run.runId, "final.result", "结果已生成", "completed")],
    canvas: {
      kind: "desktop_agent_canvas",
      taskSoil: {
        taskSoilId: "soil-skill",
        goalSummary: "review code",
        contextRefs: [],
        permissionBoundaryRefs: [],
      },
      agent: {
        status: "completed",
        answer: {
          answer: "已完成。",
          modelCallRefs: ["model-call-1"],
          toolCallRefs: [],
          evidenceRefs: [],
          resultBlocks: [],
        },
        modelCallRefs: ["model-call-1"],
        toolCallRefs: [],
        activity: [],
        context: {
          usageSummary: "技能 1",
          budget: {
            maxMessages: 20,
            maxInputTokens: 16_000,
            usedInputTokens: 120,
            tokenCountSource: "test",
            maxChars: 20_000,
            usedChars: 500,
            budgetSource: "default",
          },
          truncated: false,
          truncationReport: {
            truncated: false,
            omittedItemCount: 0,
            truncatedItemIds: [],
          },
          items: [
            {
              itemId: "context:skill:repo-review",
              sourceKind: "skill",
              summary: [
                "Triggered skill: Repo Review",
                "Why: 触发词：review",
                "Use these skill instructions when relevant. Do not mention internal skill loading unless the user asks.",
                "FULL PRIVATE SKILL BODY SHOULD NOT BE IN TRIGGERED SKILLS",
              ].join("\n"),
              truncated: false,
            },
          ],
        },
      },
      explanation: {
        resultWhyReasonable: "safe",
        observationPanelRole: "safe",
      },
    },
  });

  assert.deepEqual(workSession.triggeredSkills, [
    {
      skillId: "repo-review",
      name: "Repo Review",
      triggerReason: "触发词：review",
      summary: "Repo Review：触发词：review",
      sourceRef: "skill:repo-review",
      truncated: false,
    },
  ]);
  assert.equal(JSON.stringify(workSession.triggeredSkills).includes("FULL PRIVATE SKILL BODY"), false);
  assert.equal(workSession.contextLedger.entries.some((entry) => entry.kind === "skill"), true);
});

test("work session read model uses structured skill facts for injected and omitted states", () => {
  const run = basicRun("completed");
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [event(run.runId, "final.result", "结果已生成", "completed")],
    restoredContextLedger: {
      runId: run.runId,
      summary: "技能 2",
      entries: [
        {
          entryId: "context:skill:repo-review",
          kind: "skill",
          title: "技能",
          summary: "技能：Repo Review\n触发原因：触发词：review",
          refs: [{ kind: "event", id: "skill:repo-review" }],
          status: "used",
          skill: {
            skillId: "repo-review",
            name: "Repo Review",
            triggerReason: "触发词：review",
            summary: "Repo Review：触发词：review",
            sourceRef: "skill:repo-review",
            selectedAt: "2026-06-05T00:00:00.000Z",
            loadedAt: "2026-06-05T00:00:00.000Z",
            bodyHash: "sha256:repo-review-body",
            contentHash: "sha256:repo-review-body",
            bodyCharCount: 120,
            loadStatus: "loaded",
            injectionStatus: "injected",
            markUsedStatus: "succeeded",
            truncated: false,
            omitted: false,
            selection: {
              selectionMethod: "model",
              modelCallRef: "model-call:skill-router-2",
              candidateSkillIds: ["repo-review", "bulky-review", "writer"],
              selectedSkillIds: ["repo-review"],
              omittedReasons: [{
                code: "selection_limit",
                skillId: "bulky-review",
                skillName: "Bulky Review",
                summary: "候选匹配但超出本轮技能选择数量上限。",
                confidence: 0.5,
              }],
              rejectedReasons: [{
                code: "model_rejected",
                skillId: "writer",
                skillName: "Writer",
                summary: "模型判断当前任务不需要写作技能。",
                confidence: 0.73,
              }],
              confidence: 0.88,
              reasonSummary: "模型选择 repo-review 作为本轮唯一注入技能。",
            },
          },
        },
        {
          entryId: "context:skill:bulky-review:omitted",
          kind: "skill",
          title: "技能",
          summary: "技能：Bulky Review\n触发原因：触发词：review",
          refs: [{ kind: "event", id: "skill:bulky-review" }],
          status: "omitted",
          skill: {
            skillId: "bulky-review",
            name: "Bulky Review",
            triggerReason: "触发词：review",
            summary: "Bulky Review：触发词：review",
            sourceRef: "skill:bulky-review",
            selectedAt: "2026-06-05T00:00:00.000Z",
            loadedAt: "2026-06-05T00:00:00.000Z",
            bodyHash: "sha256:bulky-review-body",
            contentHash: "sha256:bulky-review-body",
            bodyCharCount: 4_200,
            loadStatus: "loaded",
            injectionStatus: "omitted",
            markUsedStatus: "succeeded",
            truncated: false,
            omitted: true,
          },
        },
      ],
      truncation: {
        truncated: true,
        omittedItemCount: 1,
        truncatedItemIds: [],
      },
    },
  });

  assert.deepEqual(workSession.triggeredSkills.map((skill) => ({
    skillId: skill.skillId,
    injectionStatus: skill.injectionStatus,
    omitted: skill.omitted,
    contentHash: skill.contentHash,
    loadedAt: skill.loadedAt,
  })), [
    {
      skillId: "repo-review",
      injectionStatus: "injected",
      omitted: false,
      contentHash: "sha256:repo-review-body",
      loadedAt: "2026-06-05T00:00:00.000Z",
    },
    {
      skillId: "bulky-review",
      injectionStatus: "omitted",
      omitted: true,
      contentHash: "sha256:bulky-review-body",
      loadedAt: "2026-06-05T00:00:00.000Z",
    },
  ]);
  assert.equal(workSession.triggeredSkills[0]?.selection?.selectionMethod, "model");
  assert.equal(workSession.triggeredSkills[0]?.selection?.modelCallRef, "model-call:skill-router-2");
  assert.deepEqual(workSession.triggeredSkills[0]?.selection?.candidateSkillIds, ["repo-review", "bulky-review", "writer"]);
  assert.deepEqual(workSession.triggeredSkills[0]?.selection?.selectedSkillIds, ["repo-review"]);
  assert.equal(workSession.triggeredSkills[0]?.selection?.omittedReasons?.[0]?.code, "selection_limit");
  assert.equal(workSession.triggeredSkills[0]?.selection?.rejectedReasons?.[0]?.skillId, "writer");
  assert.equal(workSession.triggeredSkills[0]?.selection?.confidence, 0.88);
  assert.equal(workSession.triggeredSkills[0]?.selection?.reasonSummary, "模型选择 repo-review 作为本轮唯一注入技能。");
  assert.equal(JSON.stringify(workSession.triggeredSkills).includes("FULL PRIVATE SKILL BODY"), false);
});

test("work session read model surfaces failed skill loading without body content", () => {
  const run = basicRun("completed");
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [],
    restoredContextLedger: {
      runId: run.runId,
      summary: "技能 1",
      entries: [
        {
          entryId: "context:skill:missing-review",
          kind: "skill",
          title: "技能",
          summary: "技能：Missing Review\n触发原因：触发词：review\n加载状态：失败（技能正文文件不存在。）",
          refs: [{ kind: "event", id: "skill:missing-review" }],
          status: "failed",
          skill: {
            skillId: "missing-review",
            name: "Missing Review",
            triggerReason: "触发词：review",
            summary: "Missing Review：技能正文加载失败。",
            sourceRef: "skill:missing-review",
            selectedAt: "2026-06-05T00:00:00.000Z",
            loadStatus: "failed",
            injectionStatus: "failed",
            bodyCharCount: 0,
            truncated: false,
            omitted: true,
            error: "技能正文文件不存在。",
            warning: "技能正文加载失败，本轮不会注入该技能正文。",
          },
        },
      ],
      truncation: {
        truncated: false,
        omittedItemCount: 0,
        truncatedItemIds: [],
      },
    },
  });

  assert.equal(workSession.triggeredSkills[0]?.loadStatus, "failed");
  assert.equal(workSession.triggeredSkills[0]?.injectionStatus, "failed");
  assert.equal(workSession.triggeredSkills[0]?.error, "技能正文文件不存在。");
  assert.equal(JSON.stringify(workSession.triggeredSkills).includes("FULL PRIVATE SKILL BODY"), false);
});

test("work session read model surfaces approval as the main stage", () => {
  const run = basicRun("approval_needed");
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [event(run.runId, "confirmation.needed", "需要确认", "approval_needed")],
    canvas: {
      kind: "desktop_agent_canvas",
      taskSoil: {
        taskSoilId: "soil-test",
        goalSummary: "删除文件",
        contextRefs: [],
        permissionBoundaryRefs: ["ask:before-delete"],
      },
      agent: {
        status: "confirmation_needed",
        pendingConfirmation: {
          confirmationId: "confirmation-test",
          title: "删除文件",
          question: "准备删除文件。",
          consequence: "批准后只执行本次删除。",
          riskLevel: "high",
          modelCallRefs: ["model-call-1"],
          toolCallRefs: ["tool-call-1"],
          sourceRefs: ["tool:tool-call-1"],
        },
        modelCallRefs: ["model-call-1"],
        toolCallRefs: ["tool-call-1"],
        activity: [],
      },
      explanation: {
        resultWhyReasonable: "safe",
        observationPanelRole: "safe",
      },
    },
  });

  assert.equal(workSession.stage, "awaiting_approval");
  assert.equal(workSession.pendingConfirmation?.confirmationId, "confirmation-test");
  assert.equal(workSession.pendingConfirmation?.actionSummary, "准备删除文件。");
  assert.equal(workSession.pendingConfirmation?.actionSummary.includes("批准后只执行本次删除"), false);
  assert.equal(workSession.deliverable, undefined);
});

test("work session read model does not keep stale canvas confirmation after approval resumes", () => {
  const run = basicRun("running");
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [event(run.runId, "confirmation.needed", "运行命令：pnpm test", "approval_needed")],
    canvas: {
      kind: "desktop_agent_canvas",
      taskSoil: {
        taskSoilId: "soil-stale-confirmation",
        goalSummary: "运行命令",
        contextRefs: [],
        permissionBoundaryRefs: ["ask:before-command"],
      },
      agent: {
        status: "confirmation_needed",
        pendingConfirmation: {
          confirmationId: "confirmation-command",
          title: "运行命令",
          question: "运行命令：pnpm test",
          consequence: "",
          riskLevel: "medium",
          modelCallRefs: ["model-call-1"],
          toolCallRefs: ["tool-call-1"],
          sourceRefs: ["tool:tool-call-1"],
        },
        modelCallRefs: ["model-call-1"],
        toolCallRefs: ["tool-call-1"],
        activity: [],
      },
      explanation: {
        resultWhyReasonable: "safe",
        observationPanelRole: "safe",
      },
    },
  });

  assert.notEqual(workSession.stage, "awaiting_approval");
  assert.equal(workSession.pendingConfirmation, undefined);
  assert.equal(workSession.safetySummary.pendingActionCount, 0);
  assert.equal(workSession.transcriptNodes?.some((node) => node.kind === "confirmation"), false);
});

test("work session read model keeps unfinished status matrix explicit without stale confirmations", () => {
  const cases: readonly {
    readonly name: string;
    readonly run: BasicAgentRun;
    readonly terminalEventType: string;
    readonly terminalEventStatus: BasicAgentRun["status"];
    readonly terminalEventSummary: string;
    readonly expectedStage: ReturnType<typeof createDesktopWorkSessionReadModel>["stage"];
    readonly expectsPendingConfirmation: boolean;
  }[] = [
    {
      name: "approval-required",
      run: workViewMatrixRun("approval_needed", "待处理", "运行命令：pnpm test"),
      terminalEventType: "confirmation.needed",
      terminalEventStatus: "approval_needed",
      terminalEventSummary: "运行命令：pnpm test",
      expectedStage: "awaiting_approval",
      expectsPendingConfirmation: true,
    },
    {
      name: "out-of-fuel",
      run: workViewMatrixRun("blocked", "需要处理", "当前轮次已到上限，任务没有完成。"),
      terminalEventType: "run.blocked",
      terminalEventStatus: "blocked",
      terminalEventSummary: "当前轮次已到上限，任务没有完成。",
      expectedStage: "blocked",
      expectsPendingConfirmation: false,
    },
    {
      name: "context-overflow",
      run: workViewMatrixRun("blocked", "需要处理", "上下文整理没有成功，任务没有完成。"),
      terminalEventType: "run.blocked",
      terminalEventStatus: "blocked",
      terminalEventSummary: "上下文整理没有成功，任务没有完成。",
      expectedStage: "blocked",
      expectsPendingConfirmation: false,
    },
    {
      name: "model-failed",
      run: workViewMatrixRun("failed", "未完成", "模型调用失败。"),
      terminalEventType: "run.failed",
      terminalEventStatus: "failed",
      terminalEventSummary: "模型调用失败。",
      expectedStage: "failed",
      expectsPendingConfirmation: false,
    },
    {
      name: "cancelled",
      run: workViewMatrixRun("cancelled", "已取消", "运行已取消。"),
      terminalEventType: "run.cancelled",
      terminalEventStatus: "cancelled",
      terminalEventSummary: "运行已取消。",
      expectedStage: "cancelled",
      expectsPendingConfirmation: false,
    },
  ];

  for (const item of cases) {
    const staleConfirmationEvent = {
      ...event(item.run.runId, "confirmation.needed", "运行命令：pnpm test", "approval_needed"),
      sequence: 1,
    };
    const terminalEvent = {
      ...event(item.run.runId, item.terminalEventType, item.terminalEventSummary, item.terminalEventStatus),
      sequence: 2,
    };
    const workSession = createDesktopWorkSessionReadModel({
      run: item.run,
      events: [staleConfirmationEvent, terminalEvent],
      canvas: {
        kind: "desktop_agent_canvas",
        taskSoil: {
          taskSoilId: `soil-${item.name}`,
          goalSummary: "运行命令",
          contextRefs: [],
          permissionBoundaryRefs: ["ask:before-command"],
        },
        agent: {
          status: "confirmation_needed",
          pendingConfirmation: {
            confirmationId: "confirmation-command",
            title: "运行命令",
            question: "运行命令：pnpm test",
            consequence: "",
            riskLevel: "medium",
            modelCallRefs: ["model-call-1"],
            toolCallRefs: ["tool-call-1"],
            sourceRefs: ["tool:tool-call-1"],
          },
          modelCallRefs: ["model-call-1"],
          toolCallRefs: ["tool-call-1"],
          activity: [],
        },
        explanation: {
          resultWhyReasonable: "safe",
          observationPanelRole: "safe",
        },
      },
    });

    assert.equal(workSession.stage, item.expectedStage, item.name);
    assert.equal(workSession.pendingConfirmation !== undefined, item.expectsPendingConfirmation, item.name);
    assert.equal(workSession.safetySummary.pendingActionCount, item.expectsPendingConfirmation ? 1 : 0, item.name);
    if (!item.expectsPendingConfirmation) {
      assert.equal(workSession.transcriptNodes.some((node) => node.kind === "confirmation"), false, item.name);
      assert.notEqual(workSession.stage, "awaiting_approval", item.name);
      assert.notEqual(workSession.stage, "completed", item.name);
      assert.equal(JSON.stringify(workSession).includes("正在处理"), false, item.name);
    }
  }
});

test("work session read model preserves concrete confirmation action", () => {
  const run = basicRun("approval_needed");
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [
      event(
        run.runId,
        "confirmation.needed",
        "删除文件：C:\\repo\\old.txt",
        "approval_needed"
      ),
    ],
    canvas: {
      kind: "desktop_agent_canvas",
      taskSoil: {
        taskSoilId: "soil-confirmation-copy",
        goalSummary: "删除文件",
        contextRefs: [],
        permissionBoundaryRefs: ["ask:before-delete"],
      },
      agent: {
        status: "confirmation_needed",
        pendingConfirmation: {
          confirmationId: "confirmation-delete",
          title: "删除文件",
          question: "删除文件：C:\\repo\\old.txt",
          consequence: "",
          riskLevel: "high",
          modelCallRefs: ["model-call-1"],
          toolCallRefs: ["tool-call-1"],
          sourceRefs: ["tool:tool-call-1"],
        },
        modelCallRefs: ["model-call-1"],
        toolCallRefs: ["tool-call-1"],
        activity: [],
      },
      explanation: {
        resultWhyReasonable: "safe",
        observationPanelRole: "safe",
      },
    },
  });

  assert.equal(workSession.pendingConfirmation?.actionSummary, "删除文件：C:\\repo\\old.txt");
  assert.equal(workSession.transcriptNodes?.some((node) => node.confirmation?.actionSummary === "删除文件：C:\\repo\\old.txt"), true);
});

test("work session transcript only emits a confirmation node for the current pending confirmation", () => {
  const run = basicRun("running");
  const confirmationEvent: RunEvent = {
    ...event(run.runId, "confirmation.needed", "运行命令：python 3", "approval_needed"),
    refs: [{ kind: "tool_call", id: "call-command" }],
  };
  const pending = {
    confirmationId: "confirmation-call-command",
    runId: run.runId,
    title: "运行命令",
    actionSummary: "运行命令：python 3",
    affectedResources: [],
    riskLevel: "medium" as const,
    requestedAt: "2026-05-12T00:00:01.000Z",
    sourceRefs: ["tool:call-command"],
  };

  const staleNodes = transcriptNodesFromRunEvents([confirmationEvent], undefined);
  const mismatchedNodes = transcriptNodesFromRunEvents([
    confirmationEvent,
  ], { ...pending, confirmationId: "confirmation-other" });
  const currentNodes = transcriptNodesFromRunEvents([confirmationEvent], pending);

  assert.equal(staleNodes.some((node) => node.kind === "confirmation"), false);
  assert.equal(mismatchedNodes.some((node) => node.kind === "confirmation"), false);
  assert.equal(currentNodes.find((node) => node.kind === "confirmation")?.confirmation?.confirmationId, "confirmation-call-command");
});

test("work session read model keeps tool evidence out of ordinary message deliverables", () => {
  const run = basicRun("completed");
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [event(run.runId, "tool.completed", "搜索已完成", "completed")],
    canvas: {
      kind: "desktop_agent_canvas",
      taskSoil: {
        taskSoilId: "soil-tool-evidence",
        goalSummary: "查找资料",
        contextRefs: [],
        permissionBoundaryRefs: ["read:web"],
      },
      agent: {
        status: "completed",
        answer: {
          answer: "已根据搜索证据回答。",
          modelCallRefs: ["model-call-1"],
          toolCallRefs: ["call-search"],
          evidenceRefs: ["tool:call-search"],
          resultBlocks: [],
        },
        modelCallRefs: ["model-call-1"],
        toolCallRefs: ["call-search"],
        activity: [],
      },
      explanation: {
        resultWhyReasonable: "safe",
        observationPanelRole: "safe",
      },
    },
    toolEvidence: [searchEnvelope()],
  });

  assert.equal(workSession.toolEvidence.length, 1);
  assert.equal(workSession.toolEvidence[0]?.uiDisplay?.kind, "search_results");
  assert.equal(workSession.answer?.content, "已根据搜索证据回答。");
  assert.equal(workSession.deliverable, undefined);
  const toolEntry = workSession.contextLedger.entries.find((entry) => entry.kind === "tool_evidence");
  assert.equal(toolEntry?.status, "used");
  assert.equal(toolEntry?.refs.some((ref) => ref.kind === "tool_call" && ref.id === "call-search"), true);
  const json = JSON.stringify(workSession);
  assert.equal(json.includes("RAW_TOOL_OUTPUT_SENTINEL"), false);
  assert.equal(json.includes("sk-tool-secret"), true);
});

test("work session visible events preserve product activity instead of tail model deltas", () => {
  const run = basicRun("completed");
  const events: RunEvent[] = [
    { ...event(run.runId, "run.started", "开始处理", "running"), sequence: 1 },
    { ...event(run.runId, "tool.completed", "file notes.md · 12 bytes", "completed"), sequence: 2 },
    ...Array.from({ length: 24 }, (_, index) => ({
      ...event(run.runId, "model.output.delta", `片段 ${index}`, "running"),
      id: `${run.runId}:delta:${index}`,
      sequence: index + 3,
      delta: `片段 ${index}`,
    })),
    { ...event(run.runId, "model.output.completed", "内容已整理。", "completed"), sequence: 27 },
    { ...event(run.runId, "final.result", "已回答：很长的最终回答", "completed"), sequence: 28 },
  ];

  const workSession = createDesktopWorkSessionReadModel({
    run,
    events,
  });

  assert.equal(workSession.visibleEvents.some((item) => item.type === "tool.completed"), true);
  assert.equal(workSession.visibleEvents.some((item) => item.type === "run.started"), false);
  assert.equal(workSession.visibleEvents.some((item) => item.type === "model.output.delta"), false);
  assert.equal(workSession.visibleEvents.some((item) => item.type === "model.output.completed"), false);
  assert.equal(workSession.visibleEvents.some((item) => item.type === "final.result"), false);
  assert.equal(workSession.currentAction, "file notes.md · 12 bytes");
});

test("work session read model closes merged reasoning on completion event", () => {
  const run = basicRun("completed");
  const events: RunEvent[] = [
    {
      ...event(run.runId, "model.reasoning.delta", "first", "running"),
      id: `${run.runId}:reasoning:1`,
      sequence: 1,
      delta: "first",
      refs: [{ kind: "model_call", id: "model-reasoning" }],
    },
    {
      ...event(run.runId, "model.reasoning.delta", "step", "running"),
      id: `${run.runId}:reasoning:2`,
      sequence: 2,
      delta: " step",
      refs: [{ kind: "model_call", id: "model-reasoning" }],
    },
    {
      ...event(run.runId, "model.reasoning.completed", "思考完成。", "completed"),
      id: `${run.runId}:reasoning:completed`,
      sequence: 3,
      refs: [{ kind: "model_call", id: "model-reasoning" }],
    },
  ];
  const workSession = createDesktopWorkSessionReadModel({ run, events });
  const thinking = workSession.transcriptNodes?.find((node) => node.kind === "thinking");

  assert.equal(thinking?.phase, "completed");
  assert.equal(thinking?.eventType, "model.reasoning.completed");
  assert.equal(thinking?.title, "");
  assert.equal(thinking?.text, "first step");
});

test("work session transcript preserves reasoning whitespace without a visible label", () => {
  const run = basicRun("completed");
  const events: RunEvent[] = [
    {
      ...event(run.runId, "model.reasoning.delta", " The", "running"),
      id: `${run.runId}:reasoning:whitespace:1`,
      sequence: 1,
      delta: " The",
      refs: [{ kind: "model_call", id: "model-reasoning-whitespace" }],
    },
    {
      ...event(run.runId, "model.reasoning.delta", " user is simply greeting. ", "running"),
      id: `${run.runId}:reasoning:whitespace:2`,
      sequence: 2,
      delta: " user is simply greeting. ",
      refs: [{ kind: "model_call", id: "model-reasoning-whitespace" }],
    },
    {
      ...event(run.runId, "model.reasoning.completed", "思考完成。", "completed"),
      id: `${run.runId}:reasoning:whitespace:completed`,
      sequence: 3,
      refs: [{ kind: "model_call", id: "model-reasoning-whitespace" }],
    },
  ];
  const workSession = createDesktopWorkSessionReadModel({ run, events });
  const thinking = workSession.transcriptNodes?.find((node) => node.kind === "thinking");

  assert.equal(thinking?.title, "");
  assert.equal(thinking?.text, " The user is simply greeting. ");
});

test("work session transcript keeps early tool activity beyond visible event window", () => {
  const run = basicRun("completed");
  const earlyToolRequest: RunEvent = {
    ...event(run.runId, "tool.requested", "读取 README.md", "running"),
    id: `${run.runId}:early-tool-request`,
    sequence: 1,
    toolName: "read_file",
    refs: [{ kind: "tool_call", id: "call-read" }],
  };
  const earlyToolResult: RunEvent = {
    ...event(run.runId, "tool.completed", "README.md · 120 bytes", "completed"),
    id: `${run.runId}:early-tool-result`,
    sequence: 2,
    toolName: "read_file",
    refs: [{ kind: "tool_call", id: "call-read" }],
  };
  const laterNotes: RunEvent[] = Array.from({ length: 22 }, (_, index) => ({
    ...event(run.runId, "agent.note.completed", `整理第 ${index + 1} 步`, "completed"),
    id: `${run.runId}:later-note-${index + 1}`,
    sequence: index + 3,
  }));

  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [earlyToolRequest, earlyToolResult, ...laterNotes],
  });

  assert.equal(workSession.visibleEvents.some((item) => item.id === earlyToolResult.id), false);
  assert.equal(workSession.transcriptNodes?.some((node) => node.eventType === "tool.completed" && node.toolName === "read_file"), true);
});

test("work session transcript projection owns reasoning node merging", () => {
  const run = basicRun("completed");
  const events: RunEvent[] = [
    {
      ...event(run.runId, "model.reasoning.delta", "first", "running"),
      id: `${run.runId}:projection:reasoning:1`,
      sequence: 1,
      delta: "first",
      refs: [{ kind: "model_call", id: "model-projection" }],
    },
    {
      ...event(run.runId, "model.reasoning.delta", "second", "running"),
      id: `${run.runId}:projection:reasoning:2`,
      sequence: 2,
      delta: " second",
      refs: [{ kind: "model_call", id: "model-projection" }],
    },
    {
      ...event(run.runId, "model.output.completed", "回答完成。", "completed"),
      id: `${run.runId}:projection:output:completed`,
      sequence: 3,
      refs: [{ kind: "model_call", id: "model-projection" }],
    },
  ];

  const thinking = transcriptNodesFromRunEvents(events, undefined).filter((node) => node.kind === "thinking");

  assert.equal(thinking.length, 1);
  assert.equal(thinking[0]?.eventType, "model.reasoning.completed");
  assert.equal(thinking[0]?.phase, "completed");
  assert.equal(thinking[0]?.text, "first second");
});

test("work session transcript preserves model side output before tool calls", () => {
  const run = basicRun("completed");
  const events: RunEvent[] = [
    {
      ...event(run.runId, "model.side.completed", "我会先读取文件再回答。", "completed"),
      id: `${run.runId}:model-side-before-tool`,
      sequence: 1,
      refs: [{ kind: "model_call", id: "model-side" }],
      detail: {
        preview: "我会先读取文件再回答。",
      },
    },
    {
      ...event(run.runId, "tool.requested", "读取 README.md", "running"),
      id: `${run.runId}:tool-requested`,
      sequence: 2,
      refs: [{ kind: "tool_call", id: "call-read" }],
    },
  ];

  const nodes = transcriptNodesFromRunEvents(events, undefined);
  const side = nodes.find((node) => node.eventType === "model.side.completed");

  assert.equal(side?.kind, "system");
  assert.equal(side?.text, "我会先读取文件再回答。");
  assert.equal(nodes.some((node) => node.eventType === "tool.requested"), true);
});

test("work session transcript suppresses ordinary startup and placeholder events", () => {
  const run = basicRun("running");
  const nodes = transcriptNodesFromRunEvents([
    { ...event(run.runId, "goal.received", "收到任务：请把目标展示出来", "running"), sequence: 1 },
    { ...event(run.runId, "run.started", "任务已开始。", "running"), sequence: 2 },
    { ...event(run.runId, "agent.note.completed", "等待模型输出。", "running"), sequence: 3 },
    { ...event(run.runId, "model.output.completed", "内容已整理。", "running"), sequence: 4 },
    { ...event(run.runId, "agent.note.completed", "先检查 README.md，再回答。", "running"), sequence: 5 },
  ], undefined);

  assert.deepEqual(nodes.map((node) => node.eventType), ["agent.note.completed"]);
  assert.equal(nodes[0]?.summary, "先检查 README.md，再回答。");
  assert.equal(JSON.stringify(nodes).includes("目标展示"), false);
  assert.equal(JSON.stringify(nodes).includes("任务已开始"), false);
  assert.equal(JSON.stringify(nodes).includes("等待模型输出"), false);
  assert.equal(JSON.stringify(nodes).includes("内容已整理"), false);
});

test("work session transcript carries tool names for readable workflow actions", () => {
  const run = basicRun("completed");
  const nodes = transcriptNodesFromRunEvents([
    {
      ...event(run.runId, "tool.completed", "文件已删除。", "completed"),
      id: `${run.runId}:delete-file-completed`,
      toolName: "delete_file",
      detail: {
        display: {
          kind: "file_change_summary",
          path: "old.txt",
        },
      },
    },
  ], undefined);
  const tool = nodes.find((node) => node.kind === "tool");

  assert.equal(tool?.toolName, "delete_file");
  assert.equal(tool?.title, "删除完成");
});

test("work session read model completes live reasoning after interleaved output", () => {
  const run = basicRun("completed");
  const events: RunEvent[] = [
    {
      ...event(run.runId, "model.reasoning.delta", "first", "running"),
      id: `${run.runId}:live:reasoning:1`,
      sequence: 1,
      delta: "first",
      refs: [{ kind: "model_call", id: "model-interleaved" }],
    },
    {
      ...event(run.runId, "model.output.delta", "answer", "running"),
      id: `${run.runId}:live:output:1`,
      sequence: 2,
      delta: "answer",
      refs: [{ kind: "model_call", id: "model-interleaved" }],
    },
    {
      ...event(run.runId, "model.reasoning.completed", "思考完成。", "completed"),
      id: `${run.runId}:reasoning:completed`,
      sequence: 3,
      refs: [{ kind: "model_call", id: "model-interleaved" }],
    },
    { ...event(run.runId, "model.output.completed", "回答完成。", "completed"), sequence: 4 },
  ];
  const workSession = createDesktopWorkSessionReadModel({ run, events });
  const thinking = workSession.transcriptNodes?.filter((node) => node.kind === "thinking" && node.eventType?.startsWith("model.reasoning"));

  assert.equal(thinking?.length, 1);
  assert.equal(thinking?.[0]?.phase, "completed");
  assert.equal(thinking?.[0]?.eventType, "model.reasoning.completed");
  assert.equal(thinking?.[0]?.text, "first");
});

test("work session read model settles reasoning when the model turn ends without explicit completion", () => {
  const run = basicRun("completed");
  const events: RunEvent[] = [
    {
      ...event(run.runId, "model.reasoning.delta", "first", "running"),
      id: `${run.runId}:live:reasoning:no-completion`,
      sequence: 1,
      delta: "first",
      refs: [{ kind: "model_call", id: "model-no-completion" }],
    },
    {
      ...event(run.runId, "model.output.delta", "answer", "running"),
      id: `${run.runId}:live:output:no-completion`,
      sequence: 2,
      delta: "answer",
      refs: [{ kind: "model_call", id: "model-no-completion" }],
    },
    {
      ...event(run.runId, "model.output.completed", "回答完成。", "completed"),
      id: `${run.runId}:output:completed:no-completion`,
      sequence: 3,
      refs: [{ kind: "model_call", id: "model-no-completion" }],
    },
    { ...event(run.runId, "final.result", "结果已生成。", "completed"), sequence: 4 },
  ];
  const workSession = createDesktopWorkSessionReadModel({ run, events });
  const thinking = workSession.transcriptNodes?.filter((node) => node.kind === "thinking" && node.eventType?.startsWith("model.reasoning"));

  assert.equal(thinking?.length, 1);
  assert.equal(thinking?.[0]?.phase, "completed");
  assert.equal(thinking?.[0]?.eventType, "model.reasoning.completed");
  assert.equal(thinking?.[0]?.text, "first");
});

test("work session read model does not promote restored summaries into chat deliverables", () => {
  const run = basicRun("completed");
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [event(run.runId, "final.result", "已恢复结果", "completed")],
    restoredResult: {
      title: "恢复结果",
      summary: "这是恢复后的摘要。",
    },
  });

  assert.equal(workSession.stage, "completed");
  assert.equal(workSession.deliverable, undefined);
});

test("work session context ledger distinguishes blocked context refs", () => {
  const run = basicRun("running");
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [],
    taskSoilInput: {
      contextRefs: [{
        kind: "file",
        ref: "file:notes.md",
        summary: "Denied file context",
      }],
      permissionBoundaryRefs: ["deny:file:notes.md"],
    },
  });

  assert.equal(workSession.contextAttachments[0]?.status, "blocked");
  assert.equal(workSession.contextLedger.entries.some((entry) => entry.status === "blocked"), true);
});

test("work session context ledger keeps budget details out of ordinary summaries", () => {
  const run = basicRun("running");
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [],
    canvas: {
      kind: "desktop_agent_canvas",
      taskSoil: {
        taskSoilId: "soil-budget-copy",
        goalSummary: "整理上下文",
        contextRefs: [],
        permissionBoundaryRefs: [],
      },
      agent: {
        status: "running",
        modelCallRefs: [],
        toolCallRefs: [],
        activity: [],
        context: {
          items: [],
          usageSummary: "",
          budget: {
            maxInputTokens: 2000,
            usedInputTokens: 120,
            tokenCountSource: "openai_tiktoken",
            maxChars: 4000,
            usedChars: 240,
            budgetSource: "model_capabilities",
          },
          truncationReport: {
            truncated: true,
            omittedItemCount: 2,
            truncatedItemIds: ["context:item:1", "context:item:2"],
          },
        },
      },
      explanation: {
        resultWhyReasonable: "safe",
        observationPanelRole: "safe",
      },
    },
  });
  const budgetEntry = workSession.contextLedger.entries.find((entry) => entry.kind === "budget");
  const omittedEntry = workSession.contextLedger.entries.find((entry) => entry.status === "omitted");
  const text = JSON.stringify(workSession.contextLedger);

  assert.equal(budgetEntry?.title, "上下文范围");
  assert.equal(budgetEntry?.summary, "已整理 240 字符；上限 4000 字符；约 120 tokens");
  assert.equal(omittedEntry?.title, "暂未使用的上下文");
  assert.equal(text.includes("maxInputTokens"), true);
  assert.equal(text.includes("tokenCountSource"), true);
  assert.equal(text.includes("maxInputTokens="), false);
  assert.equal(text.includes("tokenCountSource="), false);
  assert.equal(text.includes("模型输入"), false);
  assert.equal(text.includes("普通视图"), false);
});

test("work session current action does not mirror the user task text", () => {
  const run: BasicAgentRun = {
    ...basicRun("running"),
    goalSummary: "请处理 api_key=sk-user-task-secret-1234567890，并把目标展示出来",
  };
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [],
  });

  assert.equal(workSession.headline, "");
  assert.equal(workSession.currentAction, "");
  assert.equal(workSession.currentAction.includes("sk-user-task-secret"), false);
  assert.equal(workSession.currentAction.includes("目标"), false);
});

test("work session current action skips generic approval resume events", () => {
  const run: BasicAgentRun = {
    ...basicRun("running"),
    currentStep: "继续处理。",
  };
  const events: RunEvent[] = [
    {
      ...event(run.runId, "tool.completed", "pnpm test · 通过", "running"),
      id: `${run.runId}:tool-completed`,
      sequence: 1,
    },
    {
      ...event(run.runId, "user_approval.received", "已继续。", "running"),
      id: `${run.runId}:approval-received`,
      sequence: 2,
    },
    {
      ...event(run.runId, "run.resumed", "继续处理。", "running"),
      id: `${run.runId}:run-resumed`,
      sequence: 3,
    },
  ];
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events,
  });

  assert.equal(workSession.visibleEvents.some((item) => item.type === "user_approval.received"), false);
  assert.equal(workSession.visibleEvents.some((item) => item.type === "run.resumed"), false);
  assert.equal(workSession.currentAction, "pnpm test · 通过");
});

test("work session transcript omits approved resume nodes but keeps denied decisions", () => {
  const run = basicRun("running");
  const nodes = transcriptNodesFromRunEvents([
    {
      ...event(run.runId, "user_approval.received", "已继续。", "running"),
      id: `${run.runId}:approval-received`,
      sequence: 1,
    },
    {
      ...event(run.runId, "run.resumed", "继续处理。", "running"),
      id: `${run.runId}:run-resumed`,
      sequence: 2,
    },
    {
      ...event(run.runId, "user_approval.received", "已不执行。", "blocked"),
      id: `${run.runId}:approval-denied`,
      sequence: 3,
    },
  ], undefined);

  assert.deepEqual(nodes.map((node) => `${node.eventType}:${node.phase}:${node.summary}`), [
    "user_approval.received:denied:已不执行。",
  ]);
});

function basicRun(status: BasicAgentRun["status"]): BasicAgentRun {
  return {
    runId: "basic-run-test",
    title: "正在处理",
    goalSummary: "测试任务",
    status,
    runMode: "agent",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:01.000Z",
    requiresUserAction: status === "approval_needed",
    eventCursor: { lastSequence: 1, eventCount: 1 },
  };
}

function workViewMatrixRun(
  status: BasicAgentRun["status"],
  title: string,
  currentStep: string
): BasicAgentRun {
  return {
    runId: `matrix-${status}-${title}`,
    title,
    goalSummary: "测试任务",
    status,
    runMode: "agent",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:01.000Z",
    currentStep,
    requiresUserAction: status === "approval_needed" || status === "blocked" || status === "needs_input",
    eventCursor: { lastSequence: 2, eventCount: 2 },
  };
}

function event(runId: string, type: string, summary: string, status: BasicAgentRun["status"]): RunEvent {
  return {
    id: `${runId}:${type}`,
    runId,
    sequence: 1,
    type,
    title: summary,
    summary,
    status,
    timestamp: "2026-05-12T00:00:01.000Z",
    refs: [],
    visibility: "compact",
  };
}

function searchEnvelope(): ToolResultEnvelope {
  return {
    agentSummary: "Search found one relevant source. sk-tool-secret",
    evidenceRefs: ["tool:call-search", "web:https://example.test/agentarbor"],
    uiDisplay: {
      kind: "search_results",
      query: "AgentArbor",
      message: "search source message",
      results: [{
        title: "AgentArbor docs",
        url: "https://example.test/agentarbor",
        snippet: "safe snippet",
      }],
    },
    tokenEstimate: 16,
    truncated: false,
    redacted: false,
    diagnosticRef: "tool:call-search",
    rawRetention: "none",
  };
}
