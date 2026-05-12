import { promises as fs } from "node:fs";
import path from "node:path";
import { nowIso } from "../../kernel/id.js";

export type SkillStateRecord = {
  readonly skillId: string;
  readonly enabled?: boolean;
  readonly lastUsedAt?: string;
};

export interface SkillStateStore {
  readStates(): Promise<ReadonlyMap<string, SkillStateRecord>>;
  setEnabled(skillId: string, enabled: boolean): Promise<SkillStateRecord>;
  markUsed(skillId: string, usedAt?: string): Promise<SkillStateRecord>;
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
    const parsed = JSON.parse(raw) as { readonly skills?: readonly SkillStateRecord[] };
    return new Map((parsed.skills ?? []).map((record) => [record.skillId, sanitizeRecord(record)]));
  }

  async setEnabled(skillId: string, enabled: boolean): Promise<SkillStateRecord> {
    const states = new Map(await this.readStates());
    const previous = states.get(skillId);
    const next: SkillStateRecord = {
      skillId,
      enabled,
      lastUsedAt: previous?.lastUsedAt,
    };
    states.set(skillId, next);
    await this.writeStates(states);
    return next;
  }

  async markUsed(skillId: string, usedAt = nowIso()): Promise<SkillStateRecord> {
    const states = new Map(await this.readStates());
    const previous = states.get(skillId);
    const next: SkillStateRecord = {
      skillId,
      enabled: previous?.enabled,
      lastUsedAt: usedAt,
    };
    states.set(skillId, next);
    await this.writeStates(states);
    return next;
  }

  private async writeStates(states: ReadonlyMap<string, SkillStateRecord>): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const skills = [...states.values()].sort((left, right) => left.skillId.localeCompare(right.skillId));
    await fs.writeFile(this.filePath, `${JSON.stringify({ version: 1, skills }, null, 2)}\n`, "utf8");
  }
}

export function resolveSkillStateStorePath(configDirectory: string): string {
  return path.join(configDirectory, "skills-state.json");
}

function sanitizeRecord(record: SkillStateRecord): SkillStateRecord {
  return {
    skillId: record.skillId,
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    lastUsedAt: typeof record.lastUsedAt === "string" ? record.lastUsedAt : undefined,
  };
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}
