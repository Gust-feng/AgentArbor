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

// 运行状态只决定「是否需要立即展示会话」：启动时没有用户意图，恢复运行中/待确认会话。
// 用户显式导航（首页/知识库/搜索/空间）后不得被运行状态强制拽回，因此
// requiresImmediateConversationView 只能用于启动恢复判定，不能作为运行中的导航守卫。
// 全屏对话视图已退役（2026-08）：初始视图一律为 home，恢复动作由组合根
// surfaceConversation 路由到所属空间的右侧对话面板，不再直入 conv-active。
test("opens the quiet home view when no run needs attention", () => {
  expect(requiresImmediateConversationView(navigationInput())).toBe(false);
  expect(initialView(navigationInput())).toBe("home");
});

test("marks an active run or pending confirmation as needing immediate conversation recovery", () => {
  expect(requiresImmediateConversationView(navigationInput("running"))).toBe(true);
  expect(requiresImmediateConversationView(navigationInput(undefined, true))).toBe(true);
  expect(initialView(navigationInput("running"))).toBe("home");
  expect(initialView(navigationInput(undefined, true))).toBe("home");
});
