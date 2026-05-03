import assert from "node:assert/strict";
import test from "node:test";
import { ROOTLET_CLUSTER_KINDS, type RootletClusterKind } from "../../domain/underground/index.js";
import { getUndergroundRootletCandidateAdviceContract } from "./intelligence-contracts.js";

const EXPECTED_FIELDS: Record<RootletClusterKind, readonly string[]> = {
  option: ["summary", "tradeoffs", "applicability"],
  risk: ["summary", "impactScope", "severity", "mitigation"],
  asset_fit: ["summary", "assetRefs", "fitConditions", "doNotApplyWhen"],
  evidence: ["summary", "evidenceType", "confidence"],
  constraint: ["summary", "constraintLevel", "enforcementGate"],
  counterfactual: ["summary", "alternativeDirection", "whyNotChosen"],
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
  }
});
