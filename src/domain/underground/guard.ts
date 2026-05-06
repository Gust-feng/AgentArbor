export type GuardViolation = {
  readonly code: string;
  readonly message: string;
  readonly severity?: "error" | "warning";
  readonly sourceRef?: string;
  readonly checkedAt?: string;
};

export type GuardResult = {
  readonly passed: boolean;
  readonly violations: readonly GuardViolation[];
  readonly checkedAt: string;
  readonly fallbackReason?: string;
  readonly fallbackSourceRefs?: readonly string[];
};

export type GuardedActionOutput<T> =
  | { readonly status: "accepted"; readonly output: T; readonly guard: GuardResult & { readonly passed: true } }
  | { readonly status: "rejected"; readonly output: T; readonly guard: GuardResult & { readonly passed: false }; readonly violations: readonly GuardViolation[] }
  | { readonly status: "fallback"; readonly output: T; readonly guard: GuardResult; readonly fallbackSourceRefs: readonly string[]; readonly fallbackReason: string };

export function createGuardViolation(input: {
  readonly code: string;
  readonly message: string;
  readonly severity?: "error" | "warning";
  readonly sourceRef?: string;
}): GuardViolation {
  return {
    code: input.code,
    message: input.message,
    ...(input.severity !== undefined ? { severity: input.severity } : {}),
    ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
    checkedAt: new Date().toISOString(),
  };
}

export function createGuardResult(input: { readonly violations: readonly GuardViolation[] }): GuardResult {
  const violations = normalizeViolations(input.violations);
  const passed = !violations.some(isErrorViolation);
  return { passed, violations, checkedAt: new Date().toISOString() };
}

export function acceptGuardedAction<T>(output: T): GuardedActionOutput<T> {
  return {
    status: "accepted",
    output,
    guard: { passed: true as const, violations: [], checkedAt: new Date().toISOString() },
  };
}

export function rejectGuardedAction<T>(input: { readonly output: T; readonly violations: readonly GuardViolation[] }): GuardedActionOutput<T> {
  const violations = normalizeViolations(input.violations);
  return {
    status: "rejected",
    output: input.output,
    guard: { passed: false as const, violations, checkedAt: new Date().toISOString() },
    violations,
  };
}

export function fallbackGuardedAction<T>(input: { readonly output: T; readonly reason: string; readonly sourceRefs: readonly string[]; readonly violations?: readonly GuardViolation[] }): GuardedActionOutput<T> {
  const violations = normalizeViolations(input.violations ?? []);
  const fallbackSourceRefs = [...input.sourceRefs];
  return {
    status: "fallback",
    output: input.output,
    guard: {
      passed: !violations.some(isErrorViolation),
      violations,
      checkedAt: new Date().toISOString(),
      fallbackReason: input.reason,
      fallbackSourceRefs,
    },
    fallbackSourceRefs,
    fallbackReason: input.reason,
  };
}

function normalizeViolations(violations: readonly GuardViolation[]): GuardViolation[] {
  return violations.map((violation) => ({
    ...violation,
    checkedAt: violation.checkedAt ?? new Date().toISOString(),
  }));
}

function isErrorViolation(violation: GuardViolation): boolean {
  return violation.severity !== "warning";
}
