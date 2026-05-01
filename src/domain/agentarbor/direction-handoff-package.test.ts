import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  DIRECTION_HANDOFF_PACKAGE_FILES,
  FileSystemDirectionHandoffPackageStore,
  InMemoryDirectionHandoffPackageStore,
} from "./direction-handoff-package.js";
import { clonePackage, createDirectionHandoffPackageFixture } from "./test-fixtures.js";

test("validates and lists an approved DirectionHandoffPackage", () => {
  const { directionHandoff, directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const store = new InMemoryDirectionHandoffPackageStore();
  const saved = store.save(directionHandoffPackage);

  assert.equal(saved.manifest.directionId, directionHandoff.id);
  assert.equal(saved.manifest.directionVersion, directionHandoff.version);
  assert.equal(saved.manifest.status, "approved");
  assert.equal(saved.validation.passed, true);
  assert.deepEqual(saved.validation.warnings, []);
  assert.deepEqual(store.listVersions(directionHandoff.id), [1]);
});

test("package validation fails without a convergence review ref", () => {
  const { directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const invalidPackage = clonePackage(directionHandoffPackage);
  invalidPackage.directionHandoff.convergenceReviewRef = "";

  const validation = new InMemoryDirectionHandoffPackageStore().validate(invalidPackage);

  assert.equal(validation.passed, false);
  assert.equal(validation.errors.some((error) => error.code === "MISSING_CONVERGENCE_REVIEW_REF"), true);
});

test("package validation fails without source candidate refs", () => {
  const { directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const invalidPackage = clonePackage(directionHandoffPackage);
  invalidPackage.directionHandoff.sourceCandidateRefs = [];
  invalidPackage.candidateReferenceIndex = [];

  const validation = new InMemoryDirectionHandoffPackageStore().validate(invalidPackage);

  assert.equal(validation.passed, false);
  assert.equal(validation.errors.some((error) => error.code === "MISSING_SOURCE_CANDIDATE_REFS"), true);
});

test("package validation fails with unconverged candidates", () => {
  const { directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const invalidPackage = clonePackage(directionHandoffPackage);
  invalidPackage.directionHandoff.sourceCandidateRefs = invalidPackage.directionHandoff.sourceCandidateRefs.map((candidate) => ({
    ...candidate,
    status: "candidate",
  }));

  const validation = new InMemoryDirectionHandoffPackageStore().validate(invalidPackage);

  assert.equal(validation.passed, false);
  assert.equal(validation.errors.some((error) => error.code === "UNCONVERGED_SOURCE_CANDIDATES"), true);
});

test("package validation fails when Soil asset content is inlined", () => {
  const { directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const invalidPackage = clonePackage(directionHandoffPackage);
  (invalidPackage.directionHandoff as unknown as { soilRefs: unknown[] }).soilRefs = [
    { ref: "soil:minimal-constraints", content: "inline Soil asset body is forbidden" },
  ];

  const validation = new InMemoryDirectionHandoffPackageStore().validate(invalidPackage);

  assert.equal(validation.passed, false);
  assert.equal(validation.errors.some((error) => error.code === "INLINE_SOIL_ASSET_CONTENT"), true);
});

test("file-system DirectionHandoffPackage store round-trips through a temp directory", () => {
  const { directionHandoffPackage } = createDirectionHandoffPackageFixture();
  const tempRoot = mkdtempSync(join(tmpdir(), "agentarbor-direction-package-"));

  try {
    const store = new FileSystemDirectionHandoffPackageStore(tempRoot);
    const saved = store.save(directionHandoffPackage);
    const loaded = store.load(saved.manifest.directionId, saved.manifest.directionVersion);

    assert.equal(loaded.validation.passed, true);
    assert.deepEqual(store.listVersions(saved.manifest.directionId), [saved.manifest.directionVersion]);

    for (const file of DIRECTION_HANDOFF_PACKAGE_FILES) {
      assert.equal(
        existsSync(
          join(
            tempRoot,
            "directions",
            encodeURIComponent(saved.manifest.directionId),
            `v${saved.manifest.directionVersion}`,
            file.path
          )
        ),
        true,
        `${file.path} should be written in the temp package directory`
      );
    }
  } finally {
    if (tempRoot.startsWith(tmpdir())) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});
