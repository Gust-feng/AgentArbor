import assert from "node:assert/strict";
import test from "node:test";
import type { ModelResponse } from "../../domain/intelligence/index.js";
import { ROOTLET_CLUSTER_KINDS, type RootletClusterKind } from "../../domain/underground/index.js";
import { createModelVisibleOutputProjection } from "../../kernel/intelligence/safe-visible-output.js";
import { getUndergroundRootletCandidateAdviceContract } from "./intelligence-contracts.js";

const EXPECTED_FIELDS: Record<RootletClusterKind, readonly string[]> = {
  option: ["summary", "tradeoffs", "applicability"],
  risk: ["summary", "impactScope", "severity", "mitigation"],
  asset_fit: ["summary", "assetRefs", "fitConditions", "doNotApplyWhen"],
  evidence: ["summary", "evidenceType", "confidence"],
  constraint: ["summary", "constraintLevel", "enforcementGate"],
  counterfactual: ["summary", "alternativeDirection", "whyNotChosen"],
};

const EXPECTED_FIELD_TYPES: Record<RootletClusterKind, Record<string, "string" | "string_array">> = {
  option: { summary: "string", tradeoffs: "string_array", applicability: "string" },
  risk: { summary: "string", impactScope: "string", severity: "string", mitigation: "string" },
  asset_fit: {
    summary: "string",
    assetRefs: "string_array",
    fitConditions: "string_array",
    doNotApplyWhen: "string_array",
  },
  evidence: { summary: "string", evidenceType: "string", confidence: "string" },
  constraint: { summary: "string", constraintLevel: "string", enforcementGate: "string" },
  counterfactual: { summary: "string", alternativeDirection: "string", whyNotChosen: "string" },
};

test("every underground rootlet kind has a candidate array output contract", () => {
  for (const kind of ROOTLET_CLUSTER_KINDS) {
    const contract = getUndergroundRootletCandidateAdviceContract(kind);

    assert.equal(contract.kind, kind);
    assert.equal(contract.candidateArrayField, "candidates");
    assert.equal(contract.modelOutputContract.outputKind, "candidate");
    assert.equal(contract.modelOutputContract.format, "json_object");
    assert.deepEqual(contract.modelOutputContract.requiredFields, ["candidates"]);
    assert.equal(contract.modelOutputContract.contractId, `underground.rootlet_candidate_advice.${kind}.v2`);
    assert.deepEqual(
      contract.candidateFields.map((field) => field.name),
      EXPECTED_FIELDS[kind]
    );
    assert.deepEqual(contract.modelOutputContract.visibleOutput?.fields, EXPECTED_FIELDS[kind]);
    assert.deepEqual(contract.modelOutputContract.visibleOutput?.fieldTypes, EXPECTED_FIELD_TYPES[kind]);
  }
});

test("rootlet visible output suppresses candidates the app parser would reject", () => {
  const contract = getUndergroundRootletCandidateAdviceContract("option").modelOutputContract;
  const projection = createModelVisibleOutputProjection({
    outputContract: contract,
    response: createCompletedResponse({
      candidates: [
        {
          summary: "Parser rejects this candidate.",
          tradeoffs: "not a string array",
          applicability: "It should not be visible as approved output.",
        },
      ],
    }),
  });

  assert.equal(projection, undefined);
});

test("rootlet visible output preserves model-visible text without redaction", () => {
  const contract = getUndergroundRootletCandidateAdviceContract("option").modelOutputContract;
  const projection = createModelVisibleOutputProjection({
    outputContract: contract,
    response: createCompletedResponse({
      candidates: [
        {
          summary: "Use Tavily key tvly-visible-output-secret as ordinary model-visible text.",
          tradeoffs: ["Bearer visible-output-token remains available for debugging"],
          applicability: "api key: sk-visible-output-secret remains visible.",
        },
      ],
    }),
  });
  const text = JSON.stringify(projection);

  assert.notEqual(projection, undefined);
  assert.equal(text.includes("tvly-visible-output-secret"), true);
  assert.equal(text.includes("visible-output-token"), true);
  assert.equal(text.includes("sk-visible-output-secret"), true);
  assert.equal(text.includes("[redacted-secret]"), false);
});

function createCompletedResponse(structuredOutput: unknown): ModelResponse {
  return {
    responseId: "model-response-test",
    requestId: "model-request-test",
    providerId: "test-provider",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "test-model",
    status: "completed",
    outputKind: "candidate",
    structuredOutput,
    validation: { status: "passed", checkedAt: "2026-05-04T00:00:00.000Z", issues: [] },
    completedAt: "2026-05-04T00:00:00.000Z",
  };
}
