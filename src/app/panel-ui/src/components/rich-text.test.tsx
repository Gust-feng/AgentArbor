import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { RichText } from "./rich-text";

test("markdown code blocks expose their language and copy the code", async () => {
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  render(<RichText text={'```ts\nconst answer = 42;\n```'} />);

  expect(screen.getByText("ts")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "复制代码" }));

  expect(writeText).toHaveBeenCalledWith("const answer = 42;");
  expect(screen.getByRole("button", { name: "已复制" })).toBeTruthy();
});
