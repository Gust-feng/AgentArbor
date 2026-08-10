import assert from "node:assert/strict";
import test from "node:test";
import {
  PATH_DEPENDENCY_DIRECTORY_MAX_TOKENS,
  PATH_DEPENDENCY_SEARCH_MAX_TOKENS,
  fitPathDependencySearchMatches,
  renderPathDependencyDirectory,
  type PathDependencyDirectoryEntry,
  type PathDependencySearchMatch,
} from "./index.js";

const owner = { kind: "space", id: "space-budget" } as const;

test("directory rendering keeps ids and revisions inside the real token budget", () => {
  const entries: PathDependencyDirectoryEntry[] = Array.from({ length: 16 }, (_, index) => ({
    id: `path-dependency:${index}`,
    kind: "path_dependency",
    owner,
    title: `方法 ${index}`,
    excerpt: "x".repeat(240),
    revision: index + 1,
    contentVersion: `sha256:${"a".repeat(64)}`,
    verification: "observed",
    tags: ["download"],
  }));
  const rendered = renderPathDependencyDirectory(entries, (text) => text.length);
  assert.ok(rendered);
  assert.equal(rendered.length <= PATH_DEPENDENCY_DIRECTORY_MAX_TOKENS, true);
  assert.match(rendered, /path-dependency:0/u);
  assert.match(rendered, /revision": 1/u);
  assert.equal((rendered.match(/path-dependency:/gu) ?? []).length < entries.length, true);
});

test("search fitting preserves complete candidate facts and stops before its token budget", () => {
  const matches: PathDependencySearchMatch[] = Array.from({ length: 8 }, (_, index) => ({
    dependency: {
      id: `path-dependency:search-${index}`,
      owner,
      title: `搜索方法 ${index}`,
      methodology: "method ".repeat(120),
      sourceRunRefs: [],
      verification: { status: "observed", evidenceRefs: [] },
      evidenceRefs: [],
      revision: 1,
      contentVersion: `sha256:${"b".repeat(64)}`,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
      createdBy: "agent",
      tags: ["search"],
    },
    score: 8 - index,
    matchedFields: ["title"],
  }));
  const fitted = fitPathDependencySearchMatches(matches, (text) => text.length);
  const projected = fitted.map((match) => ({
    id: match.dependency.id,
    title: match.dependency.title,
    methodology: match.dependency.methodology.slice(0, 360),
  }));
  assert.equal(JSON.stringify(projected).length <= PATH_DEPENDENCY_SEARCH_MAX_TOKENS, true);
  assert.equal(fitted.length < matches.length, true);
  assert.equal(fitted[0]?.dependency.methodology, matches[0]?.dependency.methodology);
});
