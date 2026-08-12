import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { SkillDefinition } from "../contracts/skills";
import { SkillSettings } from "./skill-settings";

const skill: SkillDefinition = {
  id: "web-research",
  name: "web-research",
  description: "Use this skill to read long-form web content, find relevant source material, and retain the evidence needed to answer a user question without losing the original context.",
  enabled: true,
  sourceKind: "user",
  category: "research",
};

test("Skills keeps long descriptions collapsed until the user asks to read them", async () => {
  const user = userEvent.setup();
  render(<SkillSettings skills={[skill]} onRefreshSkills={vi.fn()} onUpdateSkill={vi.fn()} />);

  const description = screen.getByText(skill.description);
  expect(description.getAttribute("data-expanded")).toBeNull();
  expect(document.querySelector(".skills-row-meta")).toBeNull();

  const detailsToggle = screen.getByRole("button", { name: "查看完整说明" });
  await user.click(detailsToggle);

  expect(description.getAttribute("data-expanded")).toBe("true");
  expect(screen.getByRole("button", { name: "收起说明" })).toBeTruthy();
});

test("Skills exposes one clear state action for each skill", async () => {
  const user = userEvent.setup();
  const onUpdateSkill = vi.fn();
  render(<SkillSettings skills={[skill]} onRefreshSkills={vi.fn()} onUpdateSkill={onUpdateSkill} />);

  expect(screen.getByText("1 / 1 已启用")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "停用 web-research" }));

  expect(onUpdateSkill).toHaveBeenCalledWith(skill, false);
});