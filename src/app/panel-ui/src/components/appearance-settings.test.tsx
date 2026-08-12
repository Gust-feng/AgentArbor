import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { AppearanceSettings } from "./appearance-settings";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("style");
});

test("reading size control persists and applies the selected size", async () => {
  const user = userEvent.setup();
  render(<AppearanceSettings />);

  await user.click(screen.getByRole("radio", { name: "大号 18px" }));

  expect(screen.getByRole("radio", { name: "大号 18px" }).getAttribute("aria-checked")).toBe("true");
  expect(document.documentElement.style.getPropertyValue("--reading-body-size")).toBe("18px");
  expect(JSON.parse(window.localStorage.getItem("aa.readingPrefs") ?? "null")).toEqual({
    font: "sans",
    width: "standard",
    size: "large",
  });
});