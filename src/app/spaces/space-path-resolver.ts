import path from "node:path";
import type { SpaceReferenceItem } from "./contracts.js";

/**
 * 中性 Host path resolver：所有文件工具和后台进程复用同一份路径事实。
 * 规范化只回答“这个真实路径落在哪个引用根里”，不决定权限模式，也不读写文件内容。
 */
export type SpacePathIdentity = (value: string) => Promise<string>;

export type SpacePathResolution =
  | {
    readonly outcome: "resolved";
    readonly referenceId: string;
    readonly rootPath: string;
    readonly relativePath: string;
    readonly normalizedPath: string;
  }
  | { readonly outcome: "outside_reference"; readonly normalizedPath: string }
  | { readonly outcome: "unavailable_reference"; readonly referenceId: string; readonly normalizedPath: string }
  | { readonly outcome: "mount_conflict"; readonly referenceIds: readonly string[]; readonly normalizedPath: string };

/**
 * 规范化为比较用身份：绝对化、realpath 跟随 symlink/junction、统一分隔符、去掉非根末尾分隔符。
 * Windows 用不区分大小写的形式，Unix 保留大小写语义。目标不存在时保留词法路径。
 */
export async function canonicalSpacePathIdentity(
  value: string,
  realpath: (target: string) => Promise<string>,
  platform: string = process.platform,
): Promise<string> {
  const absolute = path.resolve(value);
  const canonical = await realpath(absolute).catch(() => absolute);
  const slashed = canonical.replaceAll("\\", "/").replace(/(?<=[^/])\/+$/u, "");
  return platform === "win32" ? slashed.toLocaleLowerCase("en-US") : slashed;
}

/** 判断 `ancestor` 是否为 `candidate` 的祖先或其本身，按段边界比较避免 `C:/work` 命中 `C:/work-2`。 */
function containsPath(ancestor: string, candidate: string): boolean {
  if (candidate === ancestor) return true;
  const prefix = ancestor.endsWith("/") ? ancestor : `${ancestor}/`;
  return candidate.startsWith(prefix);
}

/**
 * 把模型给出的真实路径解析到本轮有效的引用身份。
 * 已撤销、已删除或 `unavailable` 的引用不提供授权；多个有效根同时命中时拒绝而不猜测。
 */
export async function resolveSpacePath(input: {
  readonly requestedPath: string;
  readonly references: readonly SpaceReferenceItem[];
  readonly identity: SpacePathIdentity;
}): Promise<SpacePathResolution> {
  const normalizedPath = await input.identity(input.requestedPath);
  const roots = await Promise.all(
    input.references
      .filter((item) => item.reference.kind === "workspace_folder" || item.reference.kind === "managed_folder")
      .map(async (item) => ({
        item,
        root: await input.identity((item.reference as { readonly path: string }).path),
      })),
  );

  const matches = roots.filter(({ root }) => containsPath(root, normalizedPath));
  if (matches.length === 0) return { outcome: "outside_reference", normalizedPath };

  const usable = matches.filter(({ item }) => item.status !== "unavailable");
  if (usable.length === 0) {
    return { outcome: "unavailable_reference", referenceId: matches[0]!.item.id, normalizedPath };
  }
  if (usable.length > 1) {
    return { outcome: "mount_conflict", referenceIds: usable.map(({ item }) => item.id), normalizedPath };
  }

  const matched = usable[0]!;
  const relative = normalizedPath.slice(matched.root.length).replace(/^\/+/u, "");
  return {
    outcome: "resolved",
    referenceId: matched.item.id,
    rootPath: (matched.item.reference as { readonly path: string }).path,
    relativePath: relative,
    normalizedPath,
  };
}
