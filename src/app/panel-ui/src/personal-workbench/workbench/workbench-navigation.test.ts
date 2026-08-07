import { expect, test } from "vitest";
import type { TaskStatus } from "../../contracts/common";
import type { WorkbenchInitialViewInput, WorkbenchNavigationInput } from "./workbench-navigation";
import { initialView, requiresImmediateConversationView } from "./workbench-navigation";

function navigationInput(status?: TaskStatus, pending = false): WorkbenchInitialViewInput {
  return {
    currentRun: {
      run: status === undefined ? undefined : { status },
    },
    pendingConfirmation: pending ? {} as NonNullable<WorkbenchNavigationInput["pendingConfirmation"]> : undefined,
  };
}

test("opens the quiet home view when no run needs attention", () => {
  expect(requiresImmediateConversationView(navigationInput())).toBe(false);
  expect(initialView(navigationInput())).toBe("home");
});

test("opens the conversation view for an active run or pending confirmation", () => {
  expect(requiresImmediateConversationView(navigationInput("running"))).toBe(true);
  expect(initialView(navigationInput("running"))).toBe("conv-active");
  expect(requiresImmediateConversationView(navigationInput(undefined, true))).toBe(true);
  expect(initialView(navigationInput(undefined, true))).toBe("conv-active");
});
