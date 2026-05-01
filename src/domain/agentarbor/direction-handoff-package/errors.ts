import type { DirectionHandoffPackageValidationResult } from "./contracts.js";

export class DirectionHandoffPackageValidationError extends Error {
  readonly result: DirectionHandoffPackageValidationResult;

  constructor(result: DirectionHandoffPackageValidationResult) {
    super(`DirectionHandoffPackage validation failed: ${result.errors.map((error) => error.code).join(", ")}`);
    this.name = "DirectionHandoffPackageValidationError";
    this.result = result;
  }
}

export class DirectionHandoffPackageStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectionHandoffPackageStoreError";
  }
}
