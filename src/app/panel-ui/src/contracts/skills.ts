export type SkillDefinition = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly triggers?: readonly string[];
  readonly lastUsedAt?: string;
};
