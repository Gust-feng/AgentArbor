export type SkillDefinition = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly sourcePath?: string;
  readonly triggers?: readonly string[];
  readonly lastUsedAt?: string;
  readonly summary?: string;
  readonly category?: string;
  readonly sourceKind?: "project" | "user" | "plugin" | "admin" | "custom";
  readonly sourceRootId?: string;
  readonly sourcePrecedence?: number;
  readonly stateKey?: string;
  readonly loadError?: string;
};
