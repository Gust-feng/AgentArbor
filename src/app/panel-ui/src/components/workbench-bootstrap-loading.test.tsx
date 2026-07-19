import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { WorkbenchBootstrapLoading } from "./workbench-bootstrap-loading";

test("bootstrap loading presents one accessible status while its motion stays decorative", () => {
  const { container } = render(<WorkbenchBootstrapLoading />);

  expect(screen.getByRole("status").textContent).toContain("正在准备工作台");
  expect(container.querySelector(".app-bootstrap-visual")?.getAttribute("aria-hidden")).toBe("true");
  expect(container.querySelector(".app-bootstrap-progress")?.getAttribute("aria-hidden")).toBe("true");
});
