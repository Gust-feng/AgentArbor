import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { WorkbenchBootstrapLoading } from "./workbench-bootstrap-loading";

test("bootstrap loading presents one accessible status while its motion stays decorative", () => {
  const { container } = render(<WorkbenchBootstrapLoading />);

  const status = screen.getByRole("status", { name: "正在准备工作台" });
  expect(status.textContent).toBe("");
  expect(container.querySelector(".workbench-bootstrap-loading__visual")?.getAttribute("aria-hidden")).toBe("true");
  expect(container.querySelector(".app-bootstrap-orbit")).toBeNull();
  expect(container.querySelector(".app-bootstrap-halo")).toBeNull();
});
