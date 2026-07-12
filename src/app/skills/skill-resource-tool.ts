import path from "node:path";
import type { SkillDefinition } from "../../domain/basic-agent/index.js";
import type { ToolExecutor } from "../../domain/tools/index.js";
import type { AgentToolRegistryContribution } from "../tool-center/factory.js";
import type { ToolRegistry, ToolRegistryScope } from "../tool-center/tool-registry.js";
import {
  DEFAULT_SKILL_RESOURCE_MAX_CHARS,
  readSkillResource,
} from "./skill-resource-resolver.js";
import type { SkillRuntimeResourceType } from "./skill-loader.js";
import {
  asRecord,
  positiveInteger,
  stringOrFallback,
  truncateText,
} from "../tool-center/adapters/local-workspace-common.js";

const DEFAULT_MAX_CHARS = DEFAULT_SKILL_RESOURCE_MAX_CHARS;
const MAX_MAX_CHARS = 64_000;

export type SkillToolContext = {
  readonly skill: SkillDefinition;
  readonly loadStatus?: "loaded" | "failed";
  readonly omitted?: boolean;
};

export function createReadSkillResourceTool(
  skillContexts: readonly SkillToolContext[] = []
): ToolExecutor {
  const resources = selectedSkillResources(skillContexts);
  return {
    definition: {
      name: "read_skill_resource",
      description: "Read an indexed reference or asset from a skill selected for this run. Scripts are identified but not executed.",
      modelContract: {
        purpose: "Read supporting references or inspect asset metadata from a loaded skill package selected in this run.",
        whenToUse: [
          "Use after a selected skill says more detail is available in references or assets.",
          "Use when the skill body is not enough and an indexed resource path is needed.",
          "Use for skill-owned reference documents instead of reading package files through generic workspace tools.",
        ],
        whenNotToUse: [
          "Do not use for workspace project files; use read_file for normal workspace content.",
          "Do not use for skills that were not selected and loaded in this run.",
          "Do not use to execute skill scripts; this tool only reports script metadata.",
        ],
        inputNotes: [
          "skillId is required and must match a loaded selected skill.",
          "path is required and must be one of that skill's indexed resources.",
          "type is required: reference, asset, or script.",
          "maxChars only applies to reference text and is capped by the runtime.",
        ],
        outputNotes: [
          "Reference resources include content, hash, byte length, char count, and truncation facts.",
          "Assets and scripts never return raw file content; they return metadata and hashes only.",
          "Scripts include requiresToolExecution/notExecutableByResolver and must go through normal tool confirmation if executed elsewhere.",
        ],
        runtimeHints: [
          { label: "resource scope", value: "loaded selected skills for this run only" },
          { label: "default maxChars", value: String(DEFAULT_MAX_CHARS) },
          { label: "max maxChars", value: String(MAX_MAX_CHARS) },
        ],
        examples: [
          {
            title: "Read a skill reference",
            input: { skillId: "repo-review", path: "references/checklist.md", type: "reference", maxChars: 12000 },
          },
        ],
      },
      metadata: {
        category: "other",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "safe-preview",
          maxPreviewChars: 1200,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          skillId: { type: "string", description: "Loaded selected skill id." },
          path: { type: "string", description: "Skill-package relative resource path, such as references/guide.md." },
          type: { type: "string", enum: ["reference", "asset", "script"], description: "Resource kind." },
          maxChars: { type: "number", description: "Maximum reference characters to return." },
        },
        required: ["skillId", "path", "type"],
      },
    },
    execute: async (input, context) => {
      if (context.abortSignal?.aborted === true) {
        throw new Error("read_skill_resource cancelled.");
      }
      const record = asRecord(input);
      const skillId = stringOrFallback(record.skillId, "");
      const relativePath = stringOrFallback(record.path, "");
      const type = resourceTypeOrUndefined(record.type);
      if (skillId.length === 0) {
        throw new Error("read_skill_resource requires skillId.");
      }
      if (relativePath.length === 0) {
        throw new Error("read_skill_resource requires path.");
      }
      if (type === undefined) {
        throw new Error("read_skill_resource type must be reference, asset, or script.");
      }

      const resource = resources.get(resourceKey(skillId, type, normalizeResourcePathForKey(relativePath)));
      if (resource === undefined) {
        throw new Error(`Skill resource is not available for this run: ${skillId} ${type} ${relativePath}`);
      }

      const maxChars = Math.min(MAX_MAX_CHARS, positiveInteger(record.maxChars) ?? DEFAULT_MAX_CHARS);
      const result = await readSkillResource({
        packagePath: resource.packagePath,
        sourcePath: resource.sourcePath,
        relativePath,
        type,
        maxChars,
      });
      if (!result.ok) {
        throw Object.assign(new Error(result.errorMessage), {
          facts: {
            code: result.errorCode,
            skillId,
            path: result.relativePath || relativePath,
            type,
          },
        });
      }
      if (resource.expectedHash !== undefined && result.contentHash !== resource.expectedHash) {
        throw Object.assign(new Error("Skill resource hash does not match the run-created catalog."), {
          facts: {
            code: "resource_hash_mismatch",
            skillId,
            path: result.relativePath,
            type,
            expectedHash: resource.expectedHash,
            actualHash: result.contentHash,
          },
        });
      }

      const contentPreview = result.content === undefined ? undefined : truncateText(result.content, 1000);
      return {
        action: "read_skill_resource",
        status: "completed",
        refId: `skill:${skillId}:${type}:${result.relativePath}`,
        summary: [
          `${skillId} · ${result.relativePath}`,
          `${result.byteLength} bytes`,
          result.charCount === undefined ? undefined : `${result.charCount} chars`,
          result.truncated ? "truncated" : undefined,
          result.requiresToolExecution === true ? "script metadata only" : undefined,
        ].filter((part): part is string => part !== undefined).join(" · "),
        result: {
          skillId,
          path: result.relativePath,
          type: result.type,
          contentHash: result.contentHash,
          byteLength: result.byteLength,
          charCount: result.charCount,
          truncated: result.truncated,
          content: result.content,
          contentPreview,
          requiresToolExecution: result.requiresToolExecution,
          notExecutableByResolver: result.notExecutableByResolver,
          executionNote: result.executionNote,
        },
        truncated: result.truncated,
      };
    },
  };
}

export function hasReadableSelectedSkillResources(
  skillContexts: readonly SkillToolContext[] = []
): boolean {
  return selectedSkillResources(skillContexts).size > 0;
}

export function registerSkillResourceTool(
  registry: ToolRegistry,
  skillContexts: readonly SkillToolContext[],
  options: {
    readonly includeWhenEmpty?: boolean;
    readonly scopes?: readonly ToolRegistryScope[];
  } = {},
): void {
  if (options.includeWhenEmpty !== true && !hasReadableSelectedSkillResources(skillContexts)) {
    return;
  }
  registry.register({
    executor: createReadSkillResourceTool(skillContexts),
    scopes: options.scopes ?? ["desktop-basic"],
    enabledByDefault: true,
  });
}

export function createSkillToolRegistryContribution(
  skillContexts: readonly SkillToolContext[],
  scopes: readonly ToolRegistryScope[] = ["desktop-basic"],
): AgentToolRegistryContribution {
  return (register) => {
    if (!hasReadableSelectedSkillResources(skillContexts)) {
      return;
    }
    register({
      executor: createReadSkillResourceTool(skillContexts),
      scopes,
      enabledByDefault: true,
    });
  };
}

type SelectedSkillResource = {
  readonly skillId: string;
  readonly type: SkillRuntimeResourceType;
  readonly relativePath: string;
  readonly packagePath: string;
  readonly sourcePath: string;
  readonly expectedHash?: string;
};

function selectedSkillResources(
  skillContexts: readonly SkillToolContext[]
): ReadonlyMap<string, SelectedSkillResource> {
  const resources = new Map<string, SelectedSkillResource>();
  for (const context of skillContexts) {
    if ((context.loadStatus ?? "loaded") !== "loaded" || context.omitted === true) {
      continue;
    }
    const packageFacts = packageFactsForSkill(context.skill);
    if (packageFacts === undefined) {
      continue;
    }
    for (const item of resourceIndexForSkill(context.skill)) {
      if (!item.exists) {
        continue;
      }
      resources.set(resourceKey(context.skill.id, item.type, item.relativePath), {
        skillId: context.skill.id,
        type: item.type,
        relativePath: item.relativePath,
        packagePath: packageFacts.packagePath,
        sourcePath: packageFacts.sourcePath,
        expectedHash: item.contentHash,
      });
    }
  }
  return resources;
}

function packageFactsForSkill(skill: SkillDefinition): {
  readonly packagePath: string;
  readonly sourcePath: string;
} | undefined {
  const candidate = skill as SkillDefinition & { readonly packagePath?: unknown; readonly sourcePath?: unknown };
  if (typeof candidate.packagePath === "string" && candidate.packagePath.trim().length > 0) {
    return {
      packagePath: candidate.packagePath,
      sourcePath: typeof candidate.sourcePath === "string" ? candidate.sourcePath : path.join(candidate.packagePath, "SKILL.md"),
    };
  }
  if (typeof candidate.sourcePath === "string" && candidate.sourcePath.trim().length > 0) {
    return {
      packagePath: path.dirname(candidate.sourcePath),
      sourcePath: candidate.sourcePath,
    };
  }
  return undefined;
}

function resourceIndexForSkill(skill: SkillDefinition): readonly {
  readonly relativePath: string;
  readonly type: SkillRuntimeResourceType;
  readonly exists: boolean;
  readonly contentHash?: string;
}[] {
  const candidate = skill as SkillDefinition & { readonly resourceIndex?: unknown };
  if (Array.isArray(candidate.resourceIndex)) {
    return candidate.resourceIndex
      .map((item): {
        readonly relativePath: string;
        readonly type: SkillRuntimeResourceType;
        readonly exists: boolean;
        readonly contentHash?: string;
      } | undefined => {
        const record = asRecord(item);
        const relativePath = stringOrFallback(record.relativePath, "");
        const type = resourceTypeOrUndefined(record.type);
        if (relativePath.length === 0 || type === undefined) {
          return undefined;
        }
        return {
          relativePath: normalizeResourcePathForKey(relativePath),
          type,
          exists: record.exists === true,
          contentHash: stringOrUndefined(record.contentHash),
        };
      })
      .filter((item): item is {
        readonly relativePath: string;
        readonly type: SkillRuntimeResourceType;
        readonly exists: boolean;
        readonly contentHash?: string;
      } => item !== undefined);
  }
  const frozen = skill as SkillDefinition & { readonly resources?: unknown };
  if (!Array.isArray(frozen.resources)) {
    return [];
  }
  return frozen.resources
    .map((item): {
      readonly relativePath: string;
      readonly type: SkillRuntimeResourceType;
      readonly exists: boolean;
      readonly contentHash?: string;
    } | undefined => {
      const record = asRecord(item);
      const sourcePath = stringOrFallback(record.sourcePath, "");
      const relativePath = stringOrFallback(record.relativePath, "") || resourceRelativePathFromSource(skill, sourcePath) || "";
      const type = resourceTypeOrUndefined(record.kind);
      if (relativePath.length === 0 || type === undefined) {
        return undefined;
      }
      return {
        relativePath: normalizeResourcePathForKey(relativePath),
        type,
        exists: record.loadError === undefined,
        contentHash: stringOrUndefined(record.contentHash),
      };
    })
    .filter((item): item is {
      readonly relativePath: string;
      readonly type: SkillRuntimeResourceType;
      readonly exists: boolean;
      readonly contentHash?: string;
    } => item !== undefined);
}

function resourceRelativePathFromSource(skill: SkillDefinition, sourcePath: string): string | undefined {
  if (sourcePath.length === 0) {
    return undefined;
  }
  const packageFacts = packageFactsForSkill(skill);
  if (packageFacts === undefined) {
    return undefined;
  }
  const relativePath = path.relative(packageFacts.packagePath, sourcePath);
  if (relativePath.length === 0 || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return undefined;
  }
  return normalizeResourcePathForKey(relativePath);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function resourceTypeOrUndefined(value: unknown): SkillRuntimeResourceType | undefined {
  return value === "reference" || value === "asset" || value === "script" ? value : undefined;
}

function resourceKey(skillId: string, type: SkillRuntimeResourceType, relativePath: string): string {
  return `${skillId}:${type}:${normalizeResourcePathForKey(relativePath)}`;
}

function normalizeResourcePathForKey(value: string): string {
  return path.posix.normalize(value.trim().replace(/\\/g, "/")).replace(/^\.\//, "");
}
