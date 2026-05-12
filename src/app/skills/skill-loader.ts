import { promises as fs } from "node:fs";
import path from "node:path";
import type { SkillDefinition } from "../../domain/basic-agent/index.js";
import type { SkillStateStore } from "./skill-state-store.js";

export type SkillDiscoveryOptions = {
  readonly roots: readonly string[];
  readonly stateStore?: SkillStateStore;
};

export async function discoverSkills(options: SkillDiscoveryOptions): Promise<readonly SkillDefinition[]> {
  const discovered = await Promise.all(options.roots.map((root) => discoverSkillsUnderRoot(root)));
  const states = await options.stateStore?.readStates();
  return discovered
    .flat()
    .map((skill) => applyPersistedSkillState(skill, states?.get(skill.id)))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadSkillBody(skill: SkillDefinition): Promise<string> {
  const raw = await fs.readFile(skill.sourcePath, "utf8");
  return parseSkillMarkdown(raw).body.trim();
}

export function selectTriggeredSkills(
  goal: string,
  skills: readonly SkillDefinition[],
  limit = 4
): readonly SkillDefinition[] {
  const normalizedGoal = normalizeForMatch(goal);
  if (normalizedGoal.length === 0) {
    return [];
  }
  return skills
    .filter((skill) => skill.enabled)
    .map((skill) => ({ skill, score: scoreSkillMatch(normalizedGoal, skill) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name))
    .slice(0, Math.max(0, Math.floor(limit)))
    .map((item) => item.skill);
}

async function discoverSkillsUnderRoot(root: string): Promise<readonly SkillDefinition[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    if (isFileNotFound(error)) {
      return [];
    }
    throw error;
  });
  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => readSkillDefinition(path.join(root, entry.name, "SKILL.md"), entry.name))
  );
  return skills.filter((skill): skill is SkillDefinition => skill !== undefined);
}

async function readSkillDefinition(sourcePath: string, fallbackId: string): Promise<SkillDefinition | undefined> {
  const raw = await fs.readFile(sourcePath, "utf8").catch((error: unknown) => {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  });
  if (raw === undefined) {
    return undefined;
  }
  const parsed = parseSkillMarkdown(raw);
  const name = firstString(parsed.frontmatter.name) ?? fallbackId;
  const id = safeSkillId(firstString(parsed.frontmatter.id) ?? name);
  return {
    id,
    name,
    description: firstString(parsed.frontmatter.description) ?? firstParagraph(parsed.body) ?? "",
    enabled: booleanOrDefault(parsed.frontmatter.enabled, true),
    sourcePath: path.resolve(sourcePath),
    triggers: stringArray(parsed.frontmatter.triggers),
    lastUsedAt: firstString(parsed.frontmatter.lastUsedAt),
  };
}

function applyPersistedSkillState(
  skill: SkillDefinition,
  state: { readonly enabled?: boolean; readonly lastUsedAt?: string } | undefined
): SkillDefinition {
  if (state === undefined) {
    return skill;
  }
  return {
    ...skill,
    enabled: state.enabled ?? skill.enabled,
    lastUsedAt: state.lastUsedAt ?? skill.lastUsedAt,
  };
}

function parseSkillMarkdown(raw: string): {
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body: string;
} {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: normalized };
  }
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) {
    return { frontmatter: {}, body: normalized };
  }
  const frontmatterText = normalized.slice(4, end).trim();
  const body = normalized.slice(end + "\n---".length).replace(/^\n/, "");
  return { frontmatter: parseSimpleYaml(frontmatterText), body };
}

function parseSimpleYaml(value: string): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  const lines = value.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (match === null) {
      continue;
    }
    const key = match[1]!;
    const rest = match[2]!.trim();
    if (rest.length === 0) {
      const items: string[] = [];
      while (index + 1 < lines.length) {
        const next = lines[index + 1] ?? "";
        const itemMatch = /^\s*-\s*(.+)$/.exec(next);
        if (itemMatch === null) {
          break;
        }
        items.push(unquoteYamlString(itemMatch[1]!.trim()));
        index += 1;
      }
      result[key] = items;
    } else {
      result[key] = parseYamlScalar(rest);
    }
  }
  return result;
}

function parseYamlScalar(value: string): unknown {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => unquoteYamlString(item.trim()))
      .filter((item) => item.length > 0);
  }
  return unquoteYamlString(value);
}

function scoreSkillMatch(normalizedGoal: string, skill: SkillDefinition): number {
  const terms = [
    skill.id,
    skill.name,
    skill.description,
    ...skill.triggers,
  ].map(normalizeForMatch).filter((term) => term.length > 0);
  return terms.reduce((score, term) => {
    if (normalizedGoal.includes(term)) {
      return score + Math.min(10, Math.max(1, term.length));
    }
    return score;
  }, 0);
}

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  }
  const single = firstString(value);
  return single === undefined ? [] : [single];
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function firstParagraph(value: string): string | undefined {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/^#+\s*/, "").trim())
    .find((paragraph) => paragraph.length > 0);
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function safeSkillId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "skill";
}

function unquoteYamlString(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}
