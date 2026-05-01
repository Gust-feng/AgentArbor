import type { NutrientRequest } from "../underground/contracts.js";

export type VerificationReport = {
  id: string;
  taskId: string;
  artifactIds: string[];
  status: "passed" | "failed";
  checks: Array<{
    name: string;
    status: "passed" | "failed";
    message?: string;
  }>;
  nutrientRequestSuggestion?: NutrientRequest["reason"];
  createdAt: string;
};
