import path from "node:path";
import test from "node:test";
import { readAppSource, readPanelUiSource } from "./panel-structure-test-utils.js";

test("deep sidebar uses explicit selection guards for conversation and run ids", async () => {
  const [sidebarSource, selectionSource] = await Promise.all([
    readPanelUiSource(path.join("components", "sidebar.tsx")),
    readAppSource("panel-ui-deep-sidebar-selection.ts"),
  ]);

  includes(sidebarSource, "active={isDeepConversationActive(conversation, {");
  includes(sidebarSource, "function SidebarRenameForm(");
  includes(sidebarSource, "function SidebarConversationMenu(");
  includes(sidebarSource, "onRenameDeep: (conversationId: string, title: string) => void;");
  includes(sidebarSource, "onToggleDeepPinned: (conversationId: string, pinned: boolean) => void;");
  includes(sidebarSource, "onDeleteDeep: (conversationId: string) => void;");
  includes(sidebarSource, "const pinnedConversations = conversations.filter((conversation) => conversation.pinnedAt !== undefined);");
  includes(sidebarSource, "conversationHasActiveDeepWork");
  includes(selectionSource, "return conversation.latestRun !== undefined &&");
  includes(selectionSource, "input.activeRunId !== undefined &&");
  includes(selectionSource, "conversation.latestRun.runId === input.activeRunId;");
});

function includes(source: string, pattern: string): void {
  if (!source.includes(pattern)) {
    throw new Error(`Expected source to include: ${pattern}`);
  }
}
