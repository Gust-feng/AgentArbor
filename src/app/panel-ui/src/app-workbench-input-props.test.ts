import { describe, expect, it } from "vitest";
import { buildWorkbenchInputProps, type WorkbenchInputPropsOptions } from "./app-workbench-input-props";

describe("ordinary workbench input", () => {
  it("preserves queued messages and follows the shell running state while cancellation is pending", () => {
    let cancelCalls = 0;
    const view = buildWorkbenchInputProps(options({
      modelResponding: false,
      cancelRun: () => { cancelCalls += 1; },
    }));

    expect(view.inputProps.running).toBe(false);
    view.inputProps.onCancel?.();
    expect(cancelCalls).toBe(1);
  });

  it("queues a message while the current response is active", () => {
    let queued = "";
    let goal = "next instruction";
    let startCalls = 0;
    const view = buildWorkbenchInputProps(options({
      busy: true,
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

  it("starts a task when no response is active", () => {
    let startCalls = 0;
    const view = buildWorkbenchInputProps(options({
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
    selectTaskWorkspace: () => undefined,
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
    startTask: async () => undefined,
    cancelRun: () => undefined,
    stopDeepTask: () => undefined,
    modelResponding: true,
    deepBusy: false,
    deep: undefined,
    ...overrides,
  };
}
