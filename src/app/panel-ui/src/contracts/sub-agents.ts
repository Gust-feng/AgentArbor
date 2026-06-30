export type SubAgentSourceKind = "builtin" | "project" | "user" | "plugin" | "custom";

export type SubAgentDefinition = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category?: string;
  readonly sourceKind: SubAgentSourceKind;
  readonly sourceRootId: string;
  readonly enabled: boolean;
  readonly version?: string;
  readonly whenToUse?: readonly string[];
  readonly whenNotToUse?: readonly string[];
  readonly allowedTools?: readonly string[];
  readonly model?: string;
  readonly maxSteps?: number;
};
