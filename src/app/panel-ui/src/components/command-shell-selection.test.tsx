import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CommandShellSelection } from "./command-shell-selection";

test("uses the themed selector and explains unavailable command shells", async () => {
  const user = userEvent.setup();
  const onSaveCommandShell = vi.fn();
  render(
    <CommandShellSelection
      commandShell={{
        configuredKind: "auto",
        availableShells: [
          { kind: "cmd", label: "Windows Command Prompt", availability: "missing" },
          { kind: "sh", label: "POSIX sh", availability: "available" },
        ],
      }}
      onSaveCommandShell={onSaveCommandShell}
    />
  );

  const trigger = screen.getByRole("button", { name: "运行环境" });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");

  await user.click(trigger);

  expect(screen.getByRole("listbox", { name: "运行环境" })).toBeTruthy();
  const unavailableShell = screen.getByRole("option", { name: /Windows Command Prompt/ });
  expect((unavailableShell as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("未检测到")).toBeTruthy();

  await user.click(unavailableShell);
  expect(onSaveCommandShell).not.toHaveBeenCalled();

  await user.click(screen.getByRole("option", { name: "POSIX sh" }));
  expect(onSaveCommandShell).toHaveBeenCalledWith("sh");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("skips unavailable shells during keyboard selection", async () => {
  const user = userEvent.setup();
  const onSaveCommandShell = vi.fn();
  render(
    <CommandShellSelection
      commandShell={{
        configuredKind: "auto",
        availableShells: [
          { kind: "cmd", label: "Windows Command Prompt", availability: "missing" },
          { kind: "sh", label: "POSIX sh", availability: "available" },
        ],
      }}
      onSaveCommandShell={onSaveCommandShell}
    />
  );

  await user.tab();
  await user.keyboard("{ArrowDown}");

  expect(onSaveCommandShell).toHaveBeenCalledWith("sh");
});