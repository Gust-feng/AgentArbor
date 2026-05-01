import type { DirectionHandoffPackage, DirectionHandoffPackageStore } from "./contracts.js";
import { DirectionHandoffPackageStoreError } from "./errors.js";
import { clonePackage, packageKey } from "./utils.js";
import { validateDirectionHandoffPackage } from "./validation.js";
import { withValidation } from "./validated-package.js";

export class InMemoryDirectionHandoffPackageStore implements DirectionHandoffPackageStore {
  private readonly packages = new Map<string, DirectionHandoffPackage>();

  save(pkg: DirectionHandoffPackage): DirectionHandoffPackage {
    const stored = withValidation(pkg);
    this.packages.set(packageKey(stored.manifest.directionId, stored.manifest.directionVersion), clonePackage(stored));
    return clonePackage(stored);
  }

  load(directionId: string, version: number): DirectionHandoffPackage {
    const stored = this.packages.get(packageKey(directionId, version));
    if (stored === undefined) {
      throw new DirectionHandoffPackageStoreError(`DirectionHandoffPackage not found: ${directionId}@v${version}`);
    }
    return withValidation(clonePackage(stored));
  }

  listVersions(directionId: string): number[] {
    const prefix = `${directionId}@v`;
    return [...this.packages.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => Number(key.slice(prefix.length)))
      .filter((version) => Number.isInteger(version))
      .sort((a, b) => a - b);
  }

  validate(pkg: DirectionHandoffPackage) {
    return validateDirectionHandoffPackage(pkg);
  }
}
