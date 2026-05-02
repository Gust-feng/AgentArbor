import type { Constraint } from "../constraints.js";

export type SoilCapabilityAssetRef = {
  id: string;
  kind: "capability_asset";
  summary: string;
  evidenceRefs: string[];
};

export type SoilPathBiasRef = {
  id: string;
  kind: "path_bias";
  summary: string;
  evidenceRefs: string[];
};

export type SoilHistoricalRunRef = {
  id: string;
  kind: "historical_run";
  summary: string;
  evidenceRefs: string[];
};

export type InMemorySoilStoreSeed = {
  constraints: readonly Constraint[];
  capabilityAssetRefs?: readonly SoilCapabilityAssetRef[];
  pathBiasRefs?: readonly SoilPathBiasRef[];
  historicalRunRefs?: readonly SoilHistoricalRunRef[];
};

export interface ReadonlySoilStore {
  listConstraints(): Constraint[];
  listCapabilityAssetRefs(): SoilCapabilityAssetRef[];
  listPathBiasRefs(): SoilPathBiasRef[];
  listHistoricalRunRefs(): SoilHistoricalRunRef[];
}

export class InMemoryReadonlySoilStore implements ReadonlySoilStore {
  private readonly constraints: Constraint[];
  private readonly capabilityAssetRefs: SoilCapabilityAssetRef[];
  private readonly pathBiasRefs: SoilPathBiasRef[];
  private readonly historicalRunRefs: SoilHistoricalRunRef[];

  constructor(seed: InMemorySoilStoreSeed) {
    this.constraints = seed.constraints.map(cloneConstraint);
    this.capabilityAssetRefs = (seed.capabilityAssetRefs ?? []).map(cloneCapabilityAssetRef);
    this.pathBiasRefs = (seed.pathBiasRefs ?? []).map(clonePathBiasRef);
    this.historicalRunRefs = (seed.historicalRunRefs ?? []).map(cloneHistoricalRunRef);
  }

  listConstraints(): Constraint[] {
    return this.constraints.map(cloneConstraint);
  }

  listCapabilityAssetRefs(): SoilCapabilityAssetRef[] {
    return this.capabilityAssetRefs.map(cloneCapabilityAssetRef);
  }

  listPathBiasRefs(): SoilPathBiasRef[] {
    return this.pathBiasRefs.map(clonePathBiasRef);
  }

  listHistoricalRunRefs(): SoilHistoricalRunRef[] {
    return this.historicalRunRefs.map(cloneHistoricalRunRef);
  }
}

export function createMinimalReadonlySoilStore(constraints: readonly Constraint[]): InMemoryReadonlySoilStore {
  return new InMemoryReadonlySoilStore({
    constraints,
    capabilityAssetRefs: [
      {
        id: "soil:capability:minimal-deterministic-runtime",
        kind: "capability_asset",
        summary: "Minimal deterministic runtime capability reference; not inline asset content.",
        evidenceRefs: ["docs/开发指南/06-工程实现/06-最小实现边界.md"],
      },
    ],
    pathBiasRefs: [
      {
        id: "soil:path-bias:prefer-verified-minimal-path",
        kind: "path_bias",
        summary: "Prefer previously verified deterministic paths when hard constraints allow it.",
        evidenceRefs: ["docs/开发指南/02-核心闭环/06-路径倾向机制.md"],
      },
    ],
    historicalRunRefs: [],
  });
}

function cloneConstraint(constraint: Constraint): Constraint {
  return {
    ...constraint,
    appliesTo: [...constraint.appliesTo],
    evidenceRefs: [...constraint.evidenceRefs],
  };
}

function cloneCapabilityAssetRef(ref: SoilCapabilityAssetRef): SoilCapabilityAssetRef {
  return { ...ref, evidenceRefs: [...ref.evidenceRefs] };
}

function clonePathBiasRef(ref: SoilPathBiasRef): SoilPathBiasRef {
  return { ...ref, evidenceRefs: [...ref.evidenceRefs] };
}

function cloneHistoricalRunRef(ref: SoilHistoricalRunRef): SoilHistoricalRunRef {
  return { ...ref, evidenceRefs: [...ref.evidenceRefs] };
}
