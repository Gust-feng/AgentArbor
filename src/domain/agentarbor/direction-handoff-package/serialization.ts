import type { DirectionHandoff } from "../../underground/contracts.js";
import type { DirectionHandoffPackage, DirectionHandoffPackageFilePath } from "./contracts.js";

export function serializeDirectionHandoffPackageFiles(
  pkg: DirectionHandoffPackage
): Record<DirectionHandoffPackageFilePath, string> {
  return {
    // V0.2 treats handoff.meta.json as the canonical payload; split files are rendered views.
    "handoff.meta.json": `${JSON.stringify(pkg, null, 2)}\n`,
    "direction.md": renderDirection(pkg.directionHandoff),
    "options.json": `${JSON.stringify(pkg.directionHandoff.options, null, 2)}\n`,
    "decision-record.md": renderDecisionRecord(pkg.directionHandoff),
    "constraints.json": `${JSON.stringify(
      {
        constraintRefs: pkg.directionHandoff.constraintRefs,
        candidateConstraintRefs: pkg.directionHandoff.candidateConstraintRefs,
      },
      null,
      2
    )}\n`,
    "soil-refs.json": `${JSON.stringify({ soilRefs: pkg.directionHandoff.soilRefs }, null, 2)}\n`,
    "evidence-index.md": renderList("Evidence Index", pkg.directionHandoff.evidenceRefs),
    "risk-register.md": renderRiskRegister(pkg.directionHandoff),
    "open-questions.md": renderList("Open Questions", pkg.directionHandoff.missingInformation),
    "escalation-rules.md": renderList("Escalation Rules", pkg.directionHandoff.growthEntry.escalationRules),
    "growth-entry.json": `${JSON.stringify(pkg.directionHandoff.growthEntry, null, 2)}\n`,
  };
}

function renderDirection(handoff: DirectionHandoff): string {
  return `# Direction Handoff

Direction: ${handoff.clarifiedGoal}

## Non Goals
${markdownList(handoff.nonGoals)}

## Assumptions
${markdownList(handoff.assumptions)}

## Risks
${markdownList(handoff.risks)}
`;
}

function renderDecisionRecord(handoff: DirectionHandoff): string {
  return `# Decision Record

- retainedOptionId: ${handoff.decisionRecord.retainedOptionId}
- mergedOptionIds: ${handoff.decisionRecord.mergedOptionIds.join(", ") || "none"}
- rejectedOptionIds: ${handoff.decisionRecord.rejectedOptionIds.join(", ") || "none"}
- userDecisionRequired: ${handoff.decisionRecord.userDecisionRequired.join(", ") || "none"}
- abovegroundReferenceOptionIds: ${handoff.decisionRecord.abovegroundReferenceOptionIds.join(", ") || "none"}
`;
}

function renderRiskRegister(handoff: DirectionHandoff): string {
  const risks = handoff.riskRegister.map(
    (risk) => `- ${risk.riskId}: ${risk.name} (${risk.blockingLevel})`
  );
  return `# Risk Register

${risks.length > 0 ? risks.join("\n") : "- none"}
`;
}

function renderList(title: string, entries: string[]): string {
  return `# ${title}

${markdownList(entries)}
`;
}

function markdownList(entries: string[]): string {
  return entries.length > 0 ? entries.map((entry) => `- ${entry}`).join("\n") : "- none";
}
