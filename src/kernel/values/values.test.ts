import assert from "node:assert/strict";
import test from "node:test";

import {
  asOptionalRecord,
  asRecord,
  booleanOrUndefined,
  cloneDeep,
  toPersistedJsonShape,
  errorMessage,
  isFileNotFound,
  isNodeError,
  isPlainRecord,
  isString,
  isTransientRenameError,
  nonNegativeInteger,
  numberOrUndefined,
  positiveInteger,
  rawStringOrUndefined,
  stringArray,
  stringArrayOrUndefined,
  stringOrUndefined,
  uniqueNonBlankStrings,
  uniqueValues,
} from "./index.js";

test("record helpers separate missing records from empty records", () => {
  assert.equal(isPlainRecord({}), true);
  assert.equal(isPlainRecord({ a: 1 }), true);
  assert.equal(isPlainRecord(null), false);
  assert.equal(isPlainRecord([]), false);
  assert.equal(isPlainRecord("text"), false);

  // asRecord 折叠缺失为 {}，便于直接链式取值。
  assert.deepEqual(asRecord(null), {});
  assert.deepEqual(asRecord([1, 2]), {});
  assert.deepEqual(asRecord({ a: 1 }), { a: 1 });

  // asOptionalRecord 保留缺失信号，供需要区分默认值的调用点使用。
  assert.equal(asOptionalRecord(null), undefined);
  assert.equal(asOptionalRecord([1, 2]), undefined);
  assert.deepEqual(asOptionalRecord({}), {});
});

test("string helpers keep trimming and whitespace semantics explicit", () => {
  // 默认语义：空白等同缺失，返回 trim 后的值。
  assert.equal(stringOrUndefined("  hello  "), "hello");
  assert.equal(stringOrUndefined("   "), undefined);
  assert.equal(stringOrUndefined(""), undefined);
  assert.equal(stringOrUndefined(42), undefined);

  // 保留原始空白的变体，用于空白本身携带语义的场景。
  assert.equal(rawStringOrUndefined("  hello  "), "  hello  ");
  assert.equal(rawStringOrUndefined("   "), undefined);
  assert.equal(rawStringOrUndefined(42), undefined);

  assert.equal(isString(""), true);
  assert.equal(isString(0), false);
});

test("numeric helpers reject non-finite and out-of-range values", () => {
  assert.equal(numberOrUndefined(1.5), 1.5);
  assert.equal(numberOrUndefined(Number.NaN), undefined);
  assert.equal(numberOrUndefined(Number.POSITIVE_INFINITY), undefined);
  assert.equal(numberOrUndefined("3"), undefined);

  assert.equal(nonNegativeInteger(0), 0);
  assert.equal(nonNegativeInteger(7), 7);
  assert.equal(nonNegativeInteger(-1), undefined);
  assert.equal(nonNegativeInteger(1.5), undefined);

  assert.equal(positiveInteger(1), 1);
  assert.equal(positiveInteger(0), undefined);
  assert.equal(positiveInteger(-2), undefined);

  assert.equal(booleanOrUndefined(false), false);
  assert.equal(booleanOrUndefined("true"), undefined);
  assert.equal(booleanOrUndefined(1), undefined);
});

test("collection helpers preserve first-seen order and separate strictness levels", () => {
  assert.deepEqual(uniqueValues(["b", "a", "b"]), ["b", "a"]);
  // uniqueValues 不 trim，也不过滤空白，保留调用点已规范化的假设。
  assert.deepEqual(uniqueValues([" a", "a"]), [" a", "a"]);

  assert.deepEqual(uniqueNonBlankStrings([" a ", "a", "", "  ", "b", 5]), ["a", "b"]);

  // 严格版：任一元素非字符串即整体拒绝。
  assert.deepEqual(stringArrayOrUndefined(["a", "b"]), ["a", "b"]);
  assert.equal(stringArrayOrUndefined(["a", 1]), undefined);
  assert.equal(stringArrayOrUndefined("a"), undefined);

  // 宽松版：畸形输入折叠为空列表，逐项 trim 并丢弃空白。
  assert.deepEqual(stringArray([" a ", 1, "", "b"]), ["a", "b"]);
  assert.deepEqual(stringArray("a"), []);
});

test("error helpers normalise messages and node errno codes", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage("plain"), "plain");
  assert.equal(errorMessage(undefined), "undefined");

  assert.equal(isNodeError({ code: "ENOENT" }, "ENOENT"), true);
  assert.equal(isNodeError({ code: "EACCES" }, "ENOENT"), false);
  assert.equal(isNodeError(null, "ENOENT"), false);

  assert.equal(isFileNotFound({ code: "ENOENT" }), true);
  assert.equal(isFileNotFound({ code: "EBUSY" }), false);
});

test("transient rename detection covers every platform code the stores relied on", () => {
  // 收敛前配置存储缺 EBUSY、其余实现缺 ENOTEMPTY；这里锁定四码并集。
  for (const code of ["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"]) {
    assert.equal(isTransientRenameError({ code }), true, `${code} must stay retryable`);
  }

  assert.equal(isTransientRenameError({ code: "ENOENT" }), false);
  assert.equal(isTransientRenameError(new Error("no code")), false);
  assert.equal(isTransientRenameError(null), false);
});

test("cloneDeep preserves structures that JSON round-trips would destroy", () => {
  const source = {
    when: new Date("2026-01-01T00:00:00.000Z"),
    tags: new Set(["a", "b"]),
    index: new Map([["k", 1]]),
    nested: { list: [1, 2, 3] },
  };
  const copy = cloneDeep(source);

  assert.notEqual(copy, source);
  assert.equal(copy.when instanceof Date, true);
  assert.equal(copy.tags instanceof Set, true);
  assert.equal(copy.index instanceof Map, true);
  assert.equal(copy.index.get("k"), 1);
  assert.deepEqual(copy.nested.list, [1, 2, 3]);

  copy.nested.list.push(4);
  assert.deepEqual(source.nested.list, [1, 2, 3], "clone must not alias nested structures");
});

test("toPersistedJsonShape drops undefined keys so save results equal later reads", () => {
  // 仓储的 save() 必须返回与后续 get() 从磁盘读回完全相等的文档。
  // 磁盘上不存在值为 undefined 的键，因此这里的“有损”是持久化边界的真实语义。
  const withOptionalGaps = { runId: "run-one", pendingToolRound: undefined, revision: 2 };

  const persisted = toPersistedJsonShape(withOptionalGaps);

  assert.deepEqual(persisted, { runId: "run-one", revision: 2 });
  assert.equal("pendingToolRound" in persisted, false);

  // cloneDeep 保留这些键，因此不能在持久化边界替换 toPersistedJsonShape。
  assert.equal("pendingToolRound" in cloneDeep(withOptionalGaps), true);
});

test("cloneDeep supports circular references that JSON cloning cannot", () => {
  type Node = { name: string; self?: Node };
  const node: Node = { name: "root" };
  node.self = node;

  const copy = cloneDeep(node);

  assert.equal(copy.name, "root");
  assert.equal(copy.self, copy);
  assert.notEqual(copy, node);
});
