import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  assertOrdinaryUiSourceHasNoInternalTerms,
  readPanelUiSource,
} from "./panel-structure-test-utils.js";

test("panel React workbench consumes Basic Agent projection APIs", async () => {
  const [
    app,
    appAttachments,
    appBootstrap,
    appConfigActions,
    appRunController,
    appLiveRunUpdates,
    appSettingsController,
    runtime,
    workspacePages,
    modelSettings,
    modelCatalogPanel,
    chatEmpty,
    chatActive,
    transcriptTimeline,
    transcriptTimelineHeader,
    transcriptTimelineClassification,
    transcriptTimelineDetail,
    transcriptConfirmation,
    sidebar,
    topbar,
    modelProviderLogos,
    modelOptions,
  ] = await Promise.all([
    readPanelUiSource("App.tsx"),
    readPanelUiSource("app-attachments.ts"),
    readPanelUiSource("app-bootstrap.ts"),
    readPanelUiSource("app-config-actions.ts"),
    readPanelUiSource("app-run-controller.ts"),
    readPanelUiSource("app-live-run-updates.ts"),
    readPanelUiSource("app-settings-controller.ts"),
    readPanelUiSource("runtime.ts"),
    readPanelUiSource(path.join("components", "workspace-pages.tsx")),
    readPanelUiSource(path.join("components", "model-settings.tsx")),
    readPanelUiSource(path.join("components", "model-catalog-panel.tsx")),
    readPanelUiSource(path.join("components", "chat-empty.tsx")),
    readPanelUiSource(path.join("components", "chat-active.tsx")),
    readPanelUiSource(path.join("components", "transcript-timeline.tsx")),
    readPanelUiSource(path.join("components", "transcript-timeline-header.tsx")),
    readPanelUiSource(path.join("components", "transcript-timeline-classification.ts")),
    readPanelUiSource(path.join("components", "transcript-timeline-detail.tsx")),
    readPanelUiSource(path.join("components", "transcript-confirmation.tsx")),
    readPanelUiSource(path.join("components", "sidebar.tsx")),
    readPanelUiSource(path.join("components", "topbar.tsx")),
    readPanelUiSource("model-provider-logos.ts"),
    readPanelUiSource("model-options.ts"),
  ]);

  assert.equal(app.includes("/api/conversations"), false);
  assert.equal(appBootstrap.includes("/api/conversations"), true);
  assert.equal(app.includes("/api/basic-agent/runs/"), false);
  assert.equal(app.includes("/events?cursor="), false);
  assert.equal(appRunController.includes("/api/basic-agent/runs/"), true);
  assert.equal(appRunController.includes("/events?cursor="), false);
  assert.equal(appLiveRunUpdates.includes("safeBasicEvents"), true);
  assert.equal(runtime.includes("/stream?cursor="), true);
  assert.equal(runtime.includes("agent.note.delta"), true);
  assert.equal(runtime.includes("agent.note.completed"), true);
  assert.equal(runtime.includes("/work-session"), true);
  assert.equal(app.includes("/api/context/attachments/preview"), false);
  assert.equal(appConfigActions.includes("/api/context/attachments/preview"), false);
  assert.equal(appAttachments.includes("/api/context/attachments/preview"), true);
  assert.equal(app.includes("/api/skills"), false);
  assert.equal(appBootstrap.includes("/api/skills"), true);
  assert.equal(app.includes("/api/config/tools"), false);
  assert.equal(appBootstrap.includes("/api/config/tools"), true);
  assert.equal(app.includes("/cancel"), false);
  assert.equal(app.includes("/confirmations/"), false);
  assert.equal(app.includes("safeDesktopDetail"), false);
  assert.equal(app.includes("safeWorkSession"), false);
  assert.equal(appRunController.includes("/cancel"), true);
  assert.equal(appRunController.includes("/confirmations/"), true);
  assert.equal(appRunController.includes("safeDesktopDetail"), true);
  assert.equal(appRunController.includes("safeWorkSession"), true);
  assert.equal(runtime.includes("safeWorkSession"), true);
  assert.equal(runtime.includes("/api/desktop/runs/"), true);
  assert.equal(app.includes("/api/config/model-profiles"), false);
  assert.equal(app.includes("/model-catalog"), false);
  assert.equal(appConfigActions.includes("/api/config/model-profiles"), true);
  assert.equal(appConfigActions.includes("/model-catalog"), true);
  assert.equal(appSettingsController.includes("saveModelProviderConfig"), true);
  assert.equal(appSettingsController.includes("updateSkillState"), true);
  assert.equal(workspacePages.includes("获取模型"), false);
  assert.equal(modelSettings.includes("获取模型"), false);
  assert.equal(modelCatalogPanel.includes("获取模型"), true);
  assert.equal(chatActive.includes("model.output.delta"), false);
  assert.equal(chatActive.includes("model.reasoning.delta"), false);
  assert.equal(transcriptTimeline.includes("model.reasoning.delta"), false);
  assert.equal(transcriptTimelineHeader.includes("model.reasoning.delta"), true);
  assert.equal(chatActive.includes('kind === "thinking"'), false);
  assert.equal(transcriptTimeline.includes('kind === "thinking"'), false);
  assert.equal(transcriptTimelineDetail.includes('kind === "thinking"'), true);
  assert.equal(transcriptTimelineClassification.includes("node.eventType"), true);
  assert.equal(chatActive.includes("reasoning-block"), false);
  assert.equal(chatActive.includes("TimelineStream"), false);
  assert.equal(chatActive.includes("activityItemsFromTranscriptNodes"), false);
  assert.equal(chatActive.includes("WorkflowFrame"), false);
  assert.equal(chatActive.includes("ActivityGroup"), false);
  assert.equal(chatActive.includes("transcriptNodesFromEvents"), false);
  assert.equal(chatActive.includes("toolTranscriptTitle"), false);
  assert.equal(chatActive.includes("resultBlocks"), false);
  assert.equal(modelOptions.includes("profile.secretConfigured === true"), true);
  assert.equal(modelOptions.includes("profile.defaultAiMode !== \"fake\""), true);
  assert.equal(modelOptions.includes("profile.defaultAiMode !== \"none\""), true);
  assert.equal(modelProviderLogos.includes("默认配置"), false);
  assert.equal(modelProviderLogos.includes("value.includes(\"default\")"), false);
  assert.equal(chatEmpty.includes("任务输入"), true);
  assert.equal(chatEmpty.includes("ChatInputBar"), true);
  assert.equal(sidebar.includes("新任务"), true);
  assert.equal(sidebar.includes("工作方式"), true);
  assert.equal(sidebar.includes("技能"), false);
  assert.equal(sidebar.includes("工具"), true);
  assert.equal(sidebar.includes("设置"), true);
  assert.equal(sidebar.includes("待确认"), true);
  assert.equal(sidebar.includes("sidebar-confirmation-card"), false);
  assert.equal(sidebar.includes("最近会话"), true);
  assert.equal(topbar.includes("topbarStatusText"), true);
  assert.equal(topbar.includes("写入前确认"), false);
  assert.equal(chatActive.includes("WorkContextPanel"), false);
  assert.equal(chatActive.includes("工作上下文"), false);
  assert.equal(chatActive.includes("待确认"), false);
  assert.equal(transcriptConfirmation.includes("待确认"), true);
  assert.equal(chatActive.includes("证据"), true);
  assert.equal(chatActive.includes("成果"), false);
  assert.equal(chatActive.includes("下一步"), true);
  assert.equal(app.includes("innerHTML"), false);
  assert.equal(app.includes("raw provider"), false);
  assert.equal(app.includes("raw tool"), false);
  assert.equal(app.includes("stdout/stderr"), false);
  assertOrdinaryUiSourceHasNoInternalTerms([sidebar, topbar, chatEmpty, chatActive].join("\n"));
});
