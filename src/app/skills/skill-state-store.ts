import { promises as fs } from "node:fs";
import path from "node:path";
import type { SkillDefinition } from "../../domain/basic-agent/index.js";
import { nowIso } from "../../kernel/id.js";

export type SkillStateRecord = {
  readonly skillId: string;
  readonly stateKey?: string;
  readonly sourceKind?: SkillDefinition["sourceKind"];
  readonly sourceRootId?: string;
  readonly sourcePrecedence?: number;
  readonly enabled?: boolean;
  readonly lastUsedAt?: string;
};

export type SkillStateTarget = {
  readonly skillId: string;
  readonly stateKey?: string;
  readonly sourceKind?: SkillDefinition["sourceKind"];
  readonly sourceRootId?: string;
  readonly sourcePrecedence?: number;
};

export interface SkillStateStore {
  readStates(): Promise<ReadonlyMap<string, SkillStateRecord>>;
  setEnabled(stateKey: string, enabled: boolean, target?: SkillStateTarget): Promise<SkillStateRecord>;
  markUsed(stateKey: string, usedAt?: string, target?: SkillStateTarget): Promise<SkillStateRecord>;
}

export class FileSystemSkillStateStore implements SkillStateStore {
  constructor(private readonly filePath: string) {}

  async readStates(): Promise<ReadonlyMap<string, SkillStateRecord>> {
    const raw = await fs.readFile(this.filePath, "utf8").catch((error: unknown) => {
      if (isFileNotFound(error)) {
        return undefined;
      }
      throw error;
    });
    if (raw === undefined || raw.trim().length === 0) {
      return new Map();
    }
    const parsed = parseSkillStateFile(raw);
    const states = new Map((parsed.value.skills ?? []).map((record) => {
      const sanitized = sanitizeRecord(record);
      return [stateMapKeyForRecord(sanitized), sanitized] as const;
    }));
    if (parsed.recovered) {
      await this.writeStates(states);
    }
    return states;
  }

  private async writeStates(states: ReadonlyMap<string, SkillStateRecord>): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const skills = [...states.values()].sort((left, right) =>
      stateMapKeyForRecord(left).localeCompare(stateMapKeyForRecord(right))
    );
    await fs.writeFile(this.filePath, `${JSON.stringify({ version: 1, skills }, null, 2)}\n`, "utf8");
  }

  async setEnabled(stateKey: string, enabled: boolean, target?: SkillStateTarget): Promise<SkillStateRecord> {
    const states = new Map(await this.readStates());
    const previous = states.get(stateKey);
    const next: SkillStateRecord = {
      skillId: target?.skillId ?? previous?.skillId ?? stateKey,
      stateKey,
      sourceKind: target?.sourceKind ?? previous?.sourceKind,
      sourceRootId: target?.sourceRootId ?? previous?.sourceRootId,
      sourcePrecedence: target?.sourcePrecedence ?? previous?.sourcePrecedence,
      enabled,
      lastUsedAt: previous?.lastUsedAt,
    };
    states.set(stateKey, next);
    await this.writeStates(states);
    return next;
  }

  async markUsed(stateKey: string, usedAt = nowIso(), target?: SkillStateTarget): Promise<SkillStateRecord> {
    const states = new Map(await this.readStates());
    const previous = states.get(stateKey);
    const next: SkillStateRecord = {
      skillId: target?.skillId ?? previous?.skillId ?? stateKey,
      stateKey,
      sourceKind: target?.sourceKind ?? previous?.sourceKind,
      sourceRootId: target?.sourceRootId ?? previous?.sourceRootId,
      sourcePrecedence: target?.sourcePrecedence ?? previous?.sourcePrecedence,
      enabled: previous?.enabled,
      lastUsedAt: usedAt,
    };
    states.set(stateKey, next);
    await this.writeStates(states);
    return next;
  }
}

export function resolveSkillStateStorePath(configDirectory: string): string {
  return path.join(configDirectory, "skills-state.json");
}

function sanitizeRecord(record: SkillStateRecord): SkillStateRecord {
  const stateKey = typeof record.stateKey === "string" && record.stateKey.trim().length > 0
    ? record.stateKey.trim()
    : undefined;
  const sourceKind = isSkillSourceKind(record.sourceKind) ? record.sourceKind : undefined;
  const sourceRootId = typeof record.sourceRootId === "string" && record.sourceRootId.trim().length > 0
    ? record.sourceRootId.trim()
    : undefined;
  const sourcePrecedence = typeof record.sourcePrecedence === "number" && Number.isFinite(record.sourcePrecedence)
    ? Math.trunc(record.sourcePrecedence)
    : undefined;
  return {
    skillId: record.skillId,
    ...(stateKey === undefined ? {} : { stateKey }),
    ...(sourceKind === undefined ? {} : { sourceKind }),
    ...(sourceRootId === undefined ? {} : { sourceRootId }),
    ...(sourcePrecedence === undefined ? {} : { sourcePrecedence }),
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    lastUsedAt: typeof record.lastUsedAt === "string" ? record.lastUsedAt : undefined,
  };
}

export function skillStateKeyForSkill(skill: Pick<SkillDefinition, "id" | "sourceRootId"> & {
  readonly stateKey?: string;
}): string {
  if (typeof skill.stateKey === "string" && skill.stateKey.trim().length > 0) {
    return skill.stateKey.trim();
  }
  return skillStateKeyForFacts({
    skillId: skill.id,
    sourceRootId: skill.sourceRootId,
  });
}

export function skillStateTargetForSkill(skill: Pick<SkillDefinition, "id" | "sourceKind" | "sourceRootId" | "sourcePrecedence"> & {
  readonly stateKey?: string;
}): SkillStateTarget {
  return {
    skillId: skill.id,
    stateKey: skillStateKeyForSkill(skill),
    sourceKind: skill.sourceKind,
    sourceRootId: skill.sourceRootId,
    sourcePrecedence: skill.sourcePrecedence,
  };
}

export function skillStateKeyForFacts(input: {
  readonly skillId: string;
  readonly sourceRootId?: string;
}): string {
  const root = safeStateKeySegment(input.sourceRootId ?? "legacy");
  const skill = safeStateKeySegment(input.skillId);
  return `source:${root}:${skill}`;
}

function stateMapKeyForRecord(record: SkillStateRecord): string {
  return record.stateKey ?? record.skillId;
}

function parseSkillStateFile(raw: string): {
  readonly value: { readonly skills?: readonly SkillStateRecord[] };
  readonly recovered: boolean;
} {
  try {
    return {
      value: JSON.parse(raw) as { readonly skills?: readonly SkillStateRecord[] },
      recovered: false,
    };
  } catch (error) {
    const objectEnd = findFirstJsonObjectEnd(raw);
    if (objectEnd === undefined) {
      throw error;
    }
    const trailing = raw.slice(objectEnd);
    if (trailing.trim().length === 0) {
      throw error;
    }
    return {
      value: JSON.parse(raw.slice(0, objectEnd)) as { readonly skills?: readonly SkillStateRecord[] },
      recovered: true,
    };
  }
}

function findFirstJsonObjectEnd(raw: string): number | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = inString;
      continue;
    }
    if (character === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
      if (depth < 0) {
        return undefined;
      }
    }
  }
  return undefined;
}

function safeStateKeySegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "") || "skill";
}

function isSkillSourceKind(value: unknown): value is SkillDefinition["sourceKind"] {
  return value === "project" || value === "user" || value === "plugin" || value === "admin" || value === "custom";
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}
