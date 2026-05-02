import type { DirectionHandoffPackage } from "./contracts.js";

type AddValidationIssue = (code: string, path: string, message: string) => void;

export function validateHardConstraintTextBoundary(
  pkg: DirectionHandoffPackage,
  addIssue: AddValidationIssue
): void {
  const hardConstraintIds = new Set(
    [...pkg.directionHandoff.constraintRefs, ...pkg.directionHandoff.candidateConstraintRefs]
      .filter((constraintRef) => constraintRef.requiredLevel === "hard")
      .map((constraintRef) => constraintRef.constraintId)
  );
  if (hardConstraintIds.size === 0) {
    return;
  }

  const textEntries = collectHandoffTextEntries(pkg);
  for (const entry of textEntries) {
    if (!weakensHardConstraint(entry.text, hardConstraintIds)) {
      continue;
    }
    addIssue(
      "HARD_CONSTRAINT_WEAKENED_IN_HANDOFF_TEXT",
      entry.path,
      "DirectionHandoffPackage text must not weaken, bypass, waive, or mark hard constraints as optional."
    );
  }
}

function collectHandoffTextEntries(pkg: DirectionHandoffPackage): { path: string; text: string }[] {
  const entries: { path: string; text: string }[] = [];
  const push = (path: string, values: readonly string[]): void => {
    for (const [index, value] of values.entries()) {
      entries.push({ path: `${path}.${index}`, text: value });
    }
  };

  push("directionHandoff.nonGoals", pkg.directionHandoff.nonGoals);
  push("directionHandoff.assumptions", pkg.directionHandoff.assumptions);
  push("directionHandoff.missingInformation", pkg.directionHandoff.missingInformation);
  for (const [optionIndex, option] of pkg.directionHandoff.options.entries()) {
    push(`directionHandoff.options.${optionIndex}.unknowns`, option.unknowns);
    push(`directionHandoff.options.${optionIndex}.whyNot`, option.whyNot);
    push(`directionHandoff.options.${optionIndex}.doNotChooseWhen`, option.doNotChooseWhen);
  }
  for (const [riskIndex, risk] of pkg.directionHandoff.riskRegister.entries()) {
    entries.push({ path: `directionHandoff.riskRegister.${riskIndex}.name`, text: risk.name });
    push(`directionHandoff.riskRegister.${riskIndex}.mitigation`, risk.mitigation);
  }

  return entries;
}

function weakensHardConstraint(text: string, hardConstraintIds: ReadonlySet<string>): boolean {
  const normalized = text.toLowerCase();
  const mentionsHardConstraint =
    normalized.includes("hard constraint") ||
    normalized.includes("硬约束") ||
    [...hardConstraintIds].some((constraintId) => normalized.includes(constraintId.toLowerCase()));
  if (!mentionsHardConstraint) {
    return false;
  }

  return [
    "ignore",
    "ignored",
    "skip",
    "bypass",
    "override",
    "waive",
    "optional",
    "not required",
    "can be ignored",
    "can be skipped",
    "无需满足",
    "不需要满足",
    "可忽略",
    "可以忽略",
    "跳过",
    "绕过",
    "覆盖",
    "豁免",
    "弱化",
    "可选",
  ].some((marker) => normalized.includes(marker));
}
