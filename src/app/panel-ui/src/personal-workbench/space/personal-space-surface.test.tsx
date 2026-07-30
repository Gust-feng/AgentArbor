import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PersonalSpaceSurface, type PersonalSpaceProjection } from "./personal-space-surface";

const space: PersonalSpaceProjection = {
  spaceId: "space-reading",
  title: "阅读资料",
  items: [{
    itemId: "folder-notes",
    title: "笔记",
    kind: "managed_folder",
  }, {
    itemId: "reference-conversation",
    title: "关于阅读方法的讨论",
    kind: "conversation_reference",
  }],
};

test("collects a folder name before returning a Space command to the host", async () => {
  const user = userEvent.setup();
  const createManagedFolder = vi.fn();

  render(<PersonalSpaceSurface space={space} actions={{ createManagedFolder }} />);

  await user.click(screen.getByRole("button", { name: "空间操作" }));
  await user.click(screen.getByRole("menuitem", { name: "新建文件夹" }));
  expect(screen.getByRole("dialog", { name: "新建文件夹" })).toBeTruthy();

  await user.type(screen.getByRole("textbox", { name: "名称" }), " 调研材料 ");
  await user.click(screen.getByRole("button", { name: "新建文件夹" }));

  expect(createManagedFolder).toHaveBeenCalledWith("space-reading", "调研材料");
});

test("does not expose a virtual nested-folder command for a managed folder", async () => {
  const user = userEvent.setup();

  render(<PersonalSpaceSurface space={space} actions={{ createManagedFolder: vi.fn(), rename: vi.fn() }} />);

  await user.click(screen.getByRole("button", { name: "笔记操作" }));
  expect(screen.queryByRole("menuitem", { name: "新建子文件夹" })).toBeNull();
});

test("returns picker and explicit-current-conversation intents without inventing a Space item", async () => {
  const user = userEvent.setup();
  const addLocalFile = vi.fn();
  const addWorkspaceFolder = vi.fn();
  const addConversation = vi.fn();

  render(
    <PersonalSpaceSurface
      space={space}
      currentConversation={{ conversationId: "conversation-1", title: "当前普通对话" }}
      actions={{ addLocalFile, addWorkspaceFolder, addConversation }}
    />,
  );

  await user.click(screen.getByRole("button", { name: "空间操作" }));
  await user.click(screen.getByRole("menuitem", { name: "添加本地文件" }));
  expect(addLocalFile).toHaveBeenCalledWith("space-reading");
  expect(screen.queryByText("本地文件")).toBeNull();

  await user.click(screen.getByRole("button", { name: "空间操作" }));
  await user.click(screen.getByRole("menuitem", { name: "添加工作区文件夹" }));
  expect(addWorkspaceFolder).toHaveBeenCalledWith("space-reading");

  await user.click(screen.getByRole("button", { name: "空间操作" }));
  await user.click(screen.getByRole("menuitem", { name: "加入当前对话" }));
  expect(addConversation).toHaveBeenCalledWith("space-reading", "conversation-1", "当前普通对话");
});

test("maps display kinds to Space folder/reference commands for rename and removal", async () => {
  const user = userEvent.setup();
  const rename = vi.fn();
  const removeReference = vi.fn();

  render(<PersonalSpaceSurface space={space} actions={{ rename, removeReference }} />);

  await user.click(screen.getByRole("button", { name: "空间操作" }));
  await user.click(screen.getByRole("menuitem", { name: "重命名空间" }));
  const spaceName = screen.getByRole("textbox", { name: "名称" });
  await user.clear(spaceName);
  await user.type(spaceName, "阅读素材");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(rename).toHaveBeenCalledWith({ kind: "space", id: "space-reading" }, "阅读素材");

  await user.click(screen.getByRole("button", { name: "笔记操作" }));
  await user.click(screen.getByRole("menuitem", { name: "重命名" }));
  const name = screen.getByRole("textbox", { name: "名称" });
  await user.clear(name);
  await user.type(name, "沉淀");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(rename).toHaveBeenCalledWith({ kind: "reference", id: "folder-notes" }, "沉淀");

  await user.click(screen.getByRole("button", { name: "关于阅读方法的讨论操作" }));
  await user.click(screen.getByRole("menuitem", { name: "重命名" }));
  const referenceName = screen.getByRole("textbox", { name: "名称" });
  await user.clear(referenceName);
  await user.type(referenceName, "阅读讨论");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(rename).toHaveBeenCalledWith({ kind: "reference", id: "reference-conversation" }, "阅读讨论");

  await user.click(screen.getByRole("button", { name: "关于阅读方法的讨论操作" }));
  await user.click(screen.getByRole("menuitem", { name: "取消链接" }));
  expect(removeReference).toHaveBeenCalledWith("reference-conversation");
});

test("keeps a failed Space command visible without altering the supplied tree", async () => {
  const user = userEvent.setup();
  const addLocalFile = vi.fn().mockRejectedValue(new Error("文件选择已取消"));

  render(<PersonalSpaceSurface space={space} actions={{ addLocalFile }} />);

  await user.click(screen.getByRole("button", { name: "空间操作" }));
  await user.click(screen.getByRole("menuitem", { name: "添加本地文件" }));

  expect((await screen.findByRole("alert")).textContent).toContain("文件选择已取消");
  expect(screen.getByText("关于阅读方法的讨论")).toBeTruthy();
});
