import type { DirectionHandoffPackage } from "./contracts.js";
import { nowIso } from "./utils.js";
import { validateDirectionHandoffPackage } from "./validation.js";

export function withValidation(pkg: DirectionHandoffPackage): DirectionHandoffPackage {
  const withoutValidation = {
    ...pkg,
    validation: {
      passed: false,
      checkedAt: nowIso(),
      errors: [],
      warnings: [],
    },
  };
  return {
    ...withoutValidation,
    validation: validateDirectionHandoffPackage(withoutValidation),
  };
}
