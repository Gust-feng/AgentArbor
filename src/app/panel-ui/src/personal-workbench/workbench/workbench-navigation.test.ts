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

// 视图注意状态只决定「初始视图」：启动时没有用户意图，恢复运行中/待确认的对话页。
// 用户显式导航（首页/知识库/搜索/空间）后不得被运行状态强制拽回，因此
// requiresImmediateConversationView 只能用于 initialView，不能作为运行中的导航守卫。
test("opens the quiet home view when no run needs attention", () => {
  expect(requiresImmediateConversationView(navigationInput())).toBe(false);
  expect(initialView(navigationInput())).toBe("home");
});

test("opens the conversation view initially for an active run or pending confirmation", () => {
  expect(requiresImmediateConversationView(navigationInput("running"))).toBe(true);
  expect(initialView(navigationInput("running"))).toBe("conv-active");
  expect(requiresImmediateConversationView(navigationInput(undefined, true))).toBe(true);
  expect(initialView(navigationInput(undefined, true))).toBe("conv-active");
});