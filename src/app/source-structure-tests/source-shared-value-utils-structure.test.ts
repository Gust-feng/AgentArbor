import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { collectSourceFiles, relativePath } from "./source-structure-test-utils.js";

/**
 * 已收敛到 `src/kernel/values/` 的中性值处理函数。
 *
 * 收敛前这些函数在全仓有 146 处重复定义，且同名实现之间出现过语义分歧
 * （`asRecord` 失败返回 `{}` 还是 `undefined`、`stringOrUndefined` 是否 trim、
 * `isTransientRenameError` 覆盖哪些 errno）。其中 errno 集合的分歧已导致
 * Windows 上配置写入不重试的真实缺陷。
 *
 * 本守卫阻止这些名字在共享层之外被重新定义，防止重复实现再次扩散。
 * 详见 `docs/开发指南/06-工程实现/16-共享工具层收敛与重复实现治理.md`。
 */
const CONVERGED_VALUE_UTILITIES: readonly string[] = [
  "asRecord",
  "isPlainRecord",
  "cloneDeep",
  "toPersistedJsonShape",
  "isNodeError",
  "isFileNotFound",
  "isTransientRenameError",
  "renameWithRetry",
];

/**
 * 允许保留同名本地实现的文件，每条都必须有明确的语义差异理由。
 *
 * 这里只登记「同名但语义不同」的既有实现。新增豁免必须同时说明差异，
 * 否则应改为引用共享层，或在共享层中新增一个语义显式的命名。
 */
const SEMANTIC_DIVERGENCE_EXEMPTIONS: ReadonlyMap<string, string> = new Map([
  [
    "src/adapters/intelligence/model-provider-binding.ts",
    "asRecord 在此返回 undefined 以区分“协议字段缺失”与“空对象”，与共享层的 {} 语义不同",
  ],
  [
    "src/app/skills/skill-router.ts",
    "asRecord 在此返回 undefined，用于区分未提供的 skill 输入",
  ],
  [
    "src/app/tool-center/adapters/http-request-tool.ts",
    "asRecordOrUndefined 需要区分缺失响应体与空响应体",
  ],
  [
    "src/app/tool-projection/tool-display-normalization.ts",
    "asRecord 在此返回 undefined，用于跳过缺失的展示字段",
  ],
  [
    "src/kernel/tools/security-policy.ts",
    "asRecord 在此返回 undefined，缺失参数不得被折叠成空对象后放行",
  ],
  [
    "src/app/tool-center/adapters/context-attachment-test-support.ts",
    "asRecord 在此是测试夹具断言：非记录直接 assert 失败，而非折叠为 {}",
  ],
  [
    "src/app/tool-center/adapters/local-workspace-write-tools.ts",
    "isNodeError 在此是单参数类型守卫（error is NodeJS.ErrnoException），签名与共享层不同",
  ],
]);

/**
 * `domain/` 不在收敛范围内。
 *
 * `domain` 当前对 `kernel` 的依赖为 0，而 `kernel` 已依赖 `domain` 62 处；
 * 让 `domain` 反向引用 `kernel/values` 会形成层级环，并被既有的循环依赖测试拦截。
 * 因此 `domain` 保留自己的本地实现，直到共享层被下沉到更底层的位置。
 */
const OUT_OF_SCOPE_ROOTS: readonly string[] = ["src/domain"];

const SHARED_LAYER_ROOTS: readonly string[] = ["src/kernel/values", "src/kernel/fs"];

function declarationPattern(name: string): RegExp {
  return new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`, "mu");
}

test("converged value utilities are not redefined outside the shared kernel layer", async () => {
  const root = process.cwd();
  const files = [
    ...(await collectSourceFiles(path.join(root, "src", "app"))),
    ...(await collectSourceFiles(path.join(root, "src", "adapters"))),
    ...(await collectSourceFiles(path.join(root, "src", "kernel"))),
  ];

  const violations: string[] = [];

  for (const file of files) {
    const relative = relativePath(file);

    if (SHARED_LAYER_ROOTS.some((shared) => relative.startsWith(shared))) {
      continue;
    }
    if (OUT_OF_SCOPE_ROOTS.some((scope) => relative.startsWith(scope))) {
      continue;
    }
    // 测试文件允许构造本地替身与断言辅助函数。
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) {
      continue;
    }

    const source = await fs.readFile(file, "utf8");

    for (const name of CONVERGED_VALUE_UTILITIES) {
      if (!declarationPattern(name).test(source)) {
        continue;
      }
      if (SEMANTIC_DIVERGENCE_EXEMPTIONS.has(relative)) {
        continue;
      }
      violations.push(`${relative} redefines ${name}`);
    }
  }

  assert.deepEqual(
    violations.sort(),
    [],
    "these helpers must be imported from src/kernel/values or src/kernel/fs instead of redefined; " +
      "if the local behaviour genuinely differs, give it a distinct name and register the reason in " +
      "SEMANTIC_DIVERGENCE_EXEMPTIONS",
  );
});

test("shared value layer stays neutral and free of feature dependencies", async () => {
  const root = process.cwd();
  const sharedFiles = [
    ...(await collectSourceFiles(path.join(root, "src", "kernel", "values"))),
    ...(await collectSourceFiles(path.join(root, "src", "kernel", "fs"))),
  ];

  const violations: string[] = [];

  for (const file of sharedFiles) {
    const source = await fs.readFile(file, "utf8");
    // 共享层只能依赖 node: 内置模块与自身；任何跨层引用都会让中性工具捆绑业务语义。
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/gu)) {
      const specifier = match[1] ?? "";
      const isNodeBuiltin = specifier.startsWith("node:");
      const isSiblingModule = specifier.startsWith("./") || specifier.startsWith("../values/");
      if (!isNodeBuiltin && !isSiblingModule) {
        violations.push(`${relativePath(file)} imports ${specifier}`);
      }
    }
  }

  assert.deepEqual(
    violations.sort(),
    [],
    "src/kernel/values and src/kernel/fs must stay dependency-free mechanical helpers",
  );
});

test("the transient rename errno set stays a superset of every store's original codes", async () => {
  const source = await fs.readFile(
    path.join(process.cwd(), "src", "kernel", "values", "error.ts"),
    "utf8",
  );

  // 收敛前配置存储覆盖 EPERM/EACCES/ENOTEMPTY，其余三处覆盖 EPERM/EACCES/EBUSY。
  // 任何一项被移除都会让某条持久化路径回退到「平台抖动即失败」。
  for (const code of ["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"]) {
    assert.match(
      source,
      new RegExp(`"${code}"`, "u"),
      `${code} must remain retryable; dropping it reintroduces the Windows write failure`,
    );
  }
});
