import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ConvergenceReview, DirectionHandoff } from "../../underground/contracts.js";
import type {
  DirectionHandoffPackage,
  DirectionHandoffPackageCandidateReference,
  DirectionHandoffPackageFile,
  DirectionHandoffPackageLineage,
  DirectionHandoffPackageStore,
  DirectionHandoffPackageValidationResult,
} from "./contracts.js";
import { DirectionHandoffPackageStoreError } from "./errors.js";
import { serializeDirectionHandoffPackageFiles } from "./serialization.js";
import { clonePackage } from "./utils.js";
import { validateDirectionHandoffPackage } from "./validation.js";
import { withValidation } from "./validated-package.js";

export class FileSystemDirectionHandoffPackageStore implements DirectionHandoffPackageStore {
  constructor(private readonly rootDirectory: string) {
    if (rootDirectory.trim() === "") {
      throw new DirectionHandoffPackageStoreError(
        "FileSystemDirectionHandoffPackageStore requires an explicit root directory."
      );
    }
  }

  save(pkg: DirectionHandoffPackage): DirectionHandoffPackage {
    const stored = withValidation(pkg);
    const packageDirectory = this.packageDirectory(stored.manifest.directionId, stored.manifest.directionVersion);
    mkdirSync(packageDirectory, { recursive: true });

    const serializedFiles = serializeDirectionHandoffPackageFiles(stored);
    for (const [filePath, content] of Object.entries(serializedFiles)) {
      writeFileSync(join(packageDirectory, filePath), content, "utf8");
    }

    return clonePackage(stored);
  }

  load(directionId: string, version: number): DirectionHandoffPackage {
    const packageDirectory = this.packageDirectory(directionId, version);
    const metaPath = join(packageDirectory, "handoff.meta.json");
    if (!existsSync(metaPath)) {
      throw new DirectionHandoffPackageStoreError(`DirectionHandoffPackage not found: ${directionId}@v${version}`);
    }

    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
      manifest: DirectionHandoffPackage["manifest"];
      lineage: DirectionHandoffPackageLineage;
      directionHandoff: DirectionHandoff;
      convergenceReview: ConvergenceReview;
      candidateReferenceIndex: DirectionHandoffPackageCandidateReference[];
      files: DirectionHandoffPackageFile[];
      validation: DirectionHandoffPackageValidationResult;
    };

    return withValidation({
      manifest: meta.manifest,
      lineage: meta.lineage,
      directionHandoff: meta.directionHandoff,
      convergenceReview: meta.convergenceReview,
      candidateReferenceIndex: meta.candidateReferenceIndex,
      files: meta.files,
      validation: meta.validation,
    });
  }

  listVersions(directionId: string): number[] {
    const directionDirectory = join(this.rootDirectory, "directions", encodeURIComponent(directionId));
    if (!existsSync(directionDirectory)) {
      return [];
    }

    return readdirSync(directionDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
      .map((entry) => Number(entry.name.slice(1)))
      .sort((a, b) => a - b);
  }

  validate(pkg: DirectionHandoffPackage): DirectionHandoffPackageValidationResult {
    return validateDirectionHandoffPackage(pkg);
  }

  private packageDirectory(directionId: string, version: number): string {
    // Callers must pass a deliberate root; this store never chooses repo-root .agentarbor implicitly.
    return join(this.rootDirectory, "directions", encodeURIComponent(directionId), `v${version}`);
  }
}
