import { describe, expect, it } from "vitest";
import { workbenchInputPropsFrom, type WorkbenchInputPropsOptions } from "./app-workbench-input-props";

describe("ordinary workbench input", () => {
  it("preserves queued messages and follows the shell running state while cancellation is pending", () => {
    let cancelCalls = 0;
    let clearCalls = 0;
    const view = workbenchInputPropsFrom(options({
      modelResponding: false,
      cancelRun: () => { cancelCalls += 1; },
      clearQueuedMessages: () => { clearCalls += 1; },
    }));

    expect(view.inputProps.running).toBe(false);
    view.inputProps.onCancel?.();
    expect(cancelCalls).toBe(1);
    expect(clearCalls).toBe(1);
  });

  it("queues a message when delayed follow-up mode is selected", () => {
    let queued = "";
    let goal = "next instruction";
    let startCalls = 0;
    const view = workbenchInputPropsFrom(options({
      busy: true,
      modelResponding: true,
      followUpMode: "queue",
      goal,
      enqueueMessage: (content) => { queued = content; },
      setGoal: (value) => { goal = value; },
      startTask: () => { startCalls += 1; },
    }));

    expect(view.inputProps.allowInputWhileBusy).toBe(true);
    view.inputProps.onSubmit();
    expect(queued).toBe("next instruction");
    expect(goal).toBe("");
    expect(startCalls).toBe(0);
  });

  it("guides the current conversation immediately while a response is active", () => {
    let goal = "add one constraint";
    let startCalls = 0;
    let queued = "";
    const view = workbenchInputPropsFrom(options({
      busy: true,
      modelResponding: true,
      followUpMode: "guide",
      goal,
      setGoal: (value) => { goal = value; },
      enqueueMessage: (content) => { queued = content; },
      startTask: () => { startCalls += 1; },
    }));

    view.inputProps.onSubmit();

    expect(startCalls).toBe(1);
    expect(queued).toBe("");
    expect(goal).toBe("");
  });

  it("starts a task when no response is active", () => {
    let startCalls = 0;
    const view = workbenchInputPropsFrom(options({
      modelResponding: false,
      startTask: () => { startCalls += 1; },
    }));

    view.inputProps.onSubmit();
    expect(startCalls).toBe(1);
  });
});

function options(
  overrides: Partial<WorkbenchInputPropsOptions> = {},
): WorkbenchInputPropsOptions {
  return {
    agentClusterActive: false,
    goal: "next instruction",
    setGoal: () => undefined,
    attachments: [],
    selectAttachment: () => undefined,
    uploadAttachments: () => undefined,
    removeAttachment: () => undefined,
    contextBusy: false,
    busy: false,
    models: [],
    selectedModelId: "model-1",
    reasoningEffort: "",
    reasoningEffortEnabled: false,
    onReasoningEffortChange: () => undefined,
    toolConfirmationPolicy: "full_access",
    onToolConfirmationPolicyChange: () => undefined,
    closeSignal: 0,
    onModelSelect: () => undefined,
    onOpenSettings: () => undefined,
    submitDeepInput: () => undefined,
    enqueueMessage: () => undefined,
    startTask: async () => true,
    clearQueuedMessages: () => undefined,
    cancelRun: () => undefined,
    stopDeepTask: () => undefined,
    modelResponding: true,
    followUpMode: "queue",
    deepBusy: false,
    deep: undefined,
    ...overrides,
  };
}