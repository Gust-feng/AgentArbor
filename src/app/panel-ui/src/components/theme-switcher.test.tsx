import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ThemeSwitcher } from "./theme-switcher";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-style");
  document.documentElement.removeAttribute("data-color");
  document.documentElement.removeAttribute("data-color-preference");
});

test("selecting another style applies its compatible palette and reports both changes", async () => {
  const user = userEvent.setup();
  const onStyleChange = vi.fn();
  const onColorChange = vi.fn();
  render(
    <ThemeSwitcher
      activeStyleId="default"
      activeColorId="light"
      onStyleChange={onStyleChange}
      onColorChange={onColorChange}
    />,
  );

  await user.click(screen.getByRole("radio", { name: "纸页" }));

  expect(screen.getByRole("radio", { name: "纸页" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("radio", { name: "晨纸" }).getAttribute("aria-checked")).toBe("true");
  expect(document.documentElement.getAttribute("data-style")).toBe("classic");
  expect(document.documentElement.getAttribute("data-color")).toBe("warm");
  expect(onStyleChange).toHaveBeenCalledWith("classic");
  expect(onColorChange).toHaveBeenCalledWith("warm");
});

test("arrow keys move through style choices and keep the selected option focused", async () => {
  const user = userEvent.setup();
  render(
    <ThemeSwitcher
      activeStyleId="default"
      activeColorId="light"
      onStyleChange={() => undefined}
      onColorChange={() => undefined}
    />,
  );
  const current = screen.getByRole("radio", { name: "经典" });
  current.focus();

  await user.keyboard("{ArrowRight}");

  const selected = screen.getByRole("radio", { name: "纸页" });
  expect(selected.getAttribute("aria-checked")).toBe("true");
  expect(document.activeElement).toBe(selected);
});
