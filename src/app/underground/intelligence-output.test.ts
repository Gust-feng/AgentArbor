import assert from "node:assert/strict";
import test from "node:test";
import { ROOTLET_CLUSTER_KINDS, type RootletClusterKind } from "../../domain/underground/index.js";
import {
  formatUndergroundRootletCandidateAdviceSummary,
  parseUndergroundRootletCandidateAdviceOutput,
} from "./intelligence-output.js";

test("rootlet AI output parser accepts kind-specific candidates and truncates by budget", () => {
  for (const kind of ROOTLET_CLUSTER_KINDS) {
    const result = parseUndergroundRootletCandidateAdviceOutput({
      kind,
      output: { candidates: [candidateForKind(kind, 1), candidateForKind(kind, 2), candidateForKind(kind, 3)] },
      maxCandidates: 2,
    });

    assert.equal(result.discardedCount, 0);
    assert.equal(result.issues.length, 0);
    assert.equal(result.candidates.length, 2);
    assert.equal(result.candidates[0]?.kind, kind);
    assert.equal(result.candidates[0]?.sourceIndex, 0);
    assert.match(formatUndergroundRootletCandidateAdviceSummary(result.candidates[0]!), /candidate 1/i);
  }
});

test("rootlet AI output parser discards illegal candidate items", () => {
  const result = parseUndergroundRootletCandidateAdviceOutput({
    kind: "risk",
    output: {
      candidates: [
        { summary: "Missing risk fields." },
        "not an object",
        candidateForKind("risk", 1),
      ],
    },
    maxCandidates: 3,
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.discardedCount, 2);
  assert.equal(result.candidates[0]?.summary, "Risk candidate 1.");
  assert.equal(
    result.issues.some((issue) => issue.code === "ROOTLET_ADVICE_STRING_FIELD_REQUIRED"),
    true
  );
  assert.equal(
    result.issues.some((issue) => issue.code === "ROOTLET_ADVICE_CANDIDATE_NOT_OBJECT"),
    true
  );
});

test("rootlet AI output parser rejects missing top-level candidates array", () => {
  const result = parseUndergroundRootletCandidateAdviceOutput({
    kind: "option",
    output: { summary: "Old one-summary shape." },
    maxCandidates: 1,
  });

  assert.deepEqual(result.candidates, []);
  assert.equal(result.issues[0]?.code, "ROOTLET_ADVICE_CANDIDATES_NOT_ARRAY");
});

function candidateForKind(kind: RootletClusterKind, index: number): Record<string, unknown> {
  switch (kind) {
    case "option":
      return {
        summary: `Option candidate ${index}.`,
        tradeoffs: ["keeps convergence deterministic"],
        applicability: "When a direction option is needed.",
      };
    case "risk":
      return {
        summary: `Risk candidate ${index}.`,
        impactScope: "handoff boundary",
        severity: "medium",
        mitigation: "Keep package validation in charge.",
      };
    case "asset_fit":
      return {
        summary: `Asset fit candidate ${index}.`,
        assetRefs: ["soil:minimal-constraints"],
        fitConditions: ["refs match the goal profile"],
        doNotApplyWhen: ["asset body would be copied"],
      };
    case "evidence":
      return {
        summary: `Evidence candidate ${index}.`,
        evidenceType: "test",
        confidence: "medium",
      };
    case "constraint":
      return {
        summary: `Constraint candidate ${index}.`,
        constraintLevel: "hard",
        enforcementGate: "direction_handoff",
      };
    case "counterfactual":
      return {
        summary: `Counterfactual candidate ${index}.`,
        alternativeDirection: "Delay this route.",
        whyNotChosen: "The current direction is narrower.",
      };
  }
}
