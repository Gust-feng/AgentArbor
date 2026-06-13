import type {
  BasicAgentCapabilitySnapshot,
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../domain/config/index.js";
import type { AgentArborRunKind, AgentArborRunMode } from "./run-mode-policy.js";

export type RunFactOwner = {
  readonly runKind: AgentArborRunKind;
  readonly runMode: AgentArborRunMode;
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
};

export type RunFactCandidate = {
  readonly config?: SanitizedModelProviderConfig;
  readonly informationAccess?: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly capabilityResolution?: RunCapabilityResolution;
};

export type ResolvedRunFacts = {
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly capabilityResolution?: RunCapabilityResolution;
};

export function resolveCompatibleRunFacts(
  created: RunFactOwner,
  candidate: RunFactCandidate
): ResolvedRunFacts {
  if (created.capabilitySnapshot === undefined) {
    return {
      config: candidate.config ?? created.config,
      informationAccess: candidate.informationAccess ?? created.informationAccess,
      capabilitySnapshot: candidate.capabilitySnapshot,
      capabilityResolution: candidate.capabilityResolution ?? created.capabilityResolution,
    };
  }
  const capabilitySnapshot = compatibleRunCapabilitySnapshot(created, candidate.capabilitySnapshot);
  return {
    config: capabilitySnapshot?.activeModel ?? created.config,
    informationAccess: created.informationAccess,
    capabilitySnapshot,
    capabilityResolution: compatibleRunCapabilityResolution(created, candidate.capabilityResolution),
  };
}

function compatibleRunCapabilitySnapshot(
  created: RunFactOwner,
  candidate: RunFactCandidate["capabilitySnapshot"]
): RunFactOwner["capabilitySnapshot"] {
  if (created.capabilitySnapshot === undefined) {
    return candidate;
  }
  if (candidate === undefined) {
    return created.capabilitySnapshot;
  }
  return sameFrozenCapabilitySnapshotIdentity(created.capabilitySnapshot, candidate)
    ? candidate
    : created.capabilitySnapshot;
}

function compatibleRunCapabilityResolution(
  created: RunFactOwner,
  candidate: RunFactCandidate["capabilityResolution"]
): RunFactOwner["capabilityResolution"] {
  if (candidate === undefined) {
    return created.capabilityResolution;
  }
  if (
    created.capabilityResolution !== undefined &&
    !capabilityResolutionMatchesFrozenResolution(created.capabilityResolution, candidate)
  ) {
    return created.capabilityResolution;
  }
  if (created.capabilitySnapshot !== undefined && !capabilityResolutionMatchesFrozenRunFacts(created, candidate)) {
    return created.capabilityResolution;
  }
  return candidate;
}

function capabilityResolutionMatchesFrozenResolution(
  created: NonNullable<RunFactOwner["capabilityResolution"]>,
  candidate: NonNullable<RunFactCandidate["capabilityResolution"]>
): boolean {
  return (
    candidate.snapshotId === created.snapshotId &&
    candidate.runMode === created.runMode &&
    candidate.agentId === created.agentId &&
    candidate.agentDisplayName === created.agentDisplayName &&
    candidate.toolVisibilityProfileId === created.toolVisibilityProfileId &&
    sameJsonValue(candidate.allowedTools, created.allowedTools) &&
    sameJsonValue(candidate.toolExposures, created.toolExposures) &&
    sameJsonValue(candidate.enabledSkills, created.enabledSkills) &&
    sameJsonValue(candidate.mcpDrafts, created.mcpDrafts)
  );
}

function capabilityResolutionMatchesFrozenRunFacts(
  created: RunFactOwner,
  candidate: NonNullable<RunFactCandidate["capabilityResolution"]>
): boolean {
  const snapshot = created.capabilitySnapshot;
  if (snapshot === undefined) {
    return true;
  }
  if (candidate.snapshotId !== snapshot.snapshotId) {
    return false;
  }
  if (candidate.runMode !== created.runMode) {
    return false;
  }
  if (created.agentDefinitionRef !== undefined) {
    if (
      candidate.agentId !== created.agentDefinitionRef.agentId ||
      candidate.agentDisplayName !== created.agentDefinitionRef.agentDisplayName ||
      candidate.toolVisibilityProfileId !== created.agentDefinitionRef.toolVisibilityProfileId
    ) {
      return false;
    }
  }
  const snapshotToolsByName = new Map(snapshot.toolCatalog.tools.map((tool) => [tool.name, tool]));
  const snapshotAllowedTools = new Set(snapshot.toolCatalog.allowedTools);
  if (candidate.allowedTools.length !== new Set(candidate.allowedTools).size) {
    return false;
  }
  if (candidate.allowedTools.some((toolName) => !snapshotAllowedTools.has(toolName))) {
    return false;
  }
  const candidateAllowedTools = new Set(candidate.allowedTools);
  if (candidate.toolExposures.length !== snapshot.toolCatalog.tools.length) {
    return false;
  }
  const candidateToolNames = new Set<string>();
  for (const tool of candidate.toolExposures) {
    const snapshotTool = snapshotToolsByName.get(tool.name);
    if (snapshotTool === undefined || candidateToolNames.has(tool.name)) {
      return false;
    }
    candidateToolNames.add(tool.name);
    if (
      (tool.modelVisible && !candidateAllowedTools.has(tool.name)) ||
      (!tool.modelVisible && candidateAllowedTools.has(tool.name)) ||
      (tool.modelVisible && (!snapshotTool.enabled || snapshotTool.availability !== "available")) ||
      !runToolExposureMatchesSnapshotTool(tool, snapshotTool)
    ) {
      return false;
    }
  }
  const enabledSkillsById = new Map(
    snapshot.skillCatalog.filter((skill) => skill.enabled).map((skill) => [skill.id, skill])
  );
  if (candidate.enabledSkills.length !== enabledSkillsById.size) {
    return false;
  }
  const candidateSkillIds = new Set<string>();
  for (const skill of candidate.enabledSkills) {
    const snapshotSkill = enabledSkillsById.get(skill.id);
    if (
      snapshotSkill === undefined ||
      candidateSkillIds.has(skill.id) ||
      !runEnabledSkillMatchesSnapshotSkill(skill, snapshotSkill)
    ) {
      return false;
    }
    candidateSkillIds.add(skill.id);
  }
  const mcpCatalogByDraftId = new Map(snapshot.mcpCatalog.map((server) => [`mcp:${server.serverId}`, server]));
  if (candidate.mcpDrafts.length !== mcpCatalogByDraftId.size) {
    return false;
  }
  const candidateMcpDraftIds = new Set<string>();
  for (const draft of candidate.mcpDrafts) {
    const snapshotServer = mcpCatalogByDraftId.get(draft.draftId);
    if (
      snapshotServer === undefined ||
      candidateMcpDraftIds.has(draft.draftId) ||
      !capabilityDraftMatchesSnapshotMcpServer(draft, snapshotServer)
    ) {
      return false;
    }
    candidateMcpDraftIds.add(draft.draftId);
  }
  return true;
}

function runToolExposureMatchesSnapshotTool(
  exposure: NonNullable<RunFactCandidate["capabilityResolution"]>["toolExposures"][number],
  snapshotTool: BasicAgentCapabilitySnapshot["toolCatalog"]["tools"][number]
): boolean {
  return (
    exposure.displayName === snapshotTool.displayName &&
    exposure.enabled === snapshotTool.enabled &&
    exposure.availability === snapshotTool.availability &&
    exposure.riskLevel === snapshotTool.riskLevel &&
    exposure.operationType === snapshotTool.operationType &&
    exposure.requiresConfirmation === snapshotTool.requiresConfirmation &&
    sameJsonValue(exposure.scopes, snapshotTool.scopes)
  );
}

function runEnabledSkillMatchesSnapshotSkill(
  skill: NonNullable<RunFactCandidate["capabilityResolution"]>["enabledSkills"][number],
  snapshotSkill: BasicAgentCapabilitySnapshot["skillCatalog"][number]
): boolean {
  return (
    skill.name === snapshotSkill.name &&
    skill.description === snapshotSkill.description &&
    sameJsonValue(skill.triggers, snapshotSkill.triggers)
  );
}

function capabilityDraftMatchesSnapshotMcpServer(
  draft: NonNullable<RunFactCandidate["capabilityResolution"]>["mcpDrafts"][number],
  snapshotServer: BasicAgentCapabilitySnapshot["mcpCatalog"][number]
): boolean {
  return (
    draft.source === "mcp" &&
    draft.draftId === `mcp:${snapshotServer.serverId}` &&
    draft.label === snapshotServer.label &&
    draft.availability === snapshotServer.availability &&
    draft.enabled === snapshotServer.enabled
  );
}

function sameFrozenCapabilitySnapshotIdentity(
  created: BasicAgentCapabilitySnapshot,
  candidate: BasicAgentCapabilitySnapshot
): boolean {
  return (
    candidate.snapshotId === created.snapshotId &&
    candidate.createdAt === created.createdAt &&
    sameActiveModelIdentity(created.activeModel, candidate.activeModel) &&
    sameJsonValue(candidate.modelCapabilities, created.modelCapabilities) &&
    sameJsonValue(candidate.toolCatalog, created.toolCatalog) &&
    sameJsonValue(candidate.skillCatalog, created.skillCatalog) &&
    sameJsonValue(candidate.mcpCatalog, created.mcpCatalog) &&
    sameJsonValue(candidate.workspace, created.workspace) &&
    sameJsonValue(candidate.commandShell, created.commandShell) &&
    candidate.securitySummary === created.securitySummary &&
    sameJsonValue(candidate.warnings, created.warnings)
  );
}

function sameActiveModelIdentity(
  created: BasicAgentCapabilitySnapshot["activeModel"],
  candidate: BasicAgentCapabilitySnapshot["activeModel"]
): boolean {
  return (
    candidate.profileId === created.profileId &&
    candidate.label === created.label &&
    candidate.providerKind === created.providerKind &&
    candidate.protocolKind === created.protocolKind &&
    candidate.baseUrl === created.baseUrl &&
    candidate.model === created.model &&
    candidate.defaultAiMode === created.defaultAiMode &&
    candidate.secretRef === created.secretRef &&
    candidate.enabled === created.enabled &&
    candidate.secretConfigured === created.secretConfigured &&
    candidate.secretUpdatedAt === created.secretUpdatedAt &&
    candidate.updatedAt === created.updatedAt
  );
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
