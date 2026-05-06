export type UndergroundGuardSeverity = "warning" | "error";

export type UndergroundGuardViolation = {
  readonly code: string;
  readonly message: string;
  readonly severity: UndergroundGuardSeverity;
  readonly sourceRef?: string;
};

export type UndergroundGuardResult = {
  readonly passed: boolean;
  readonly violations: readonly UndergroundGuardViolation[];
  readonly fallbackReason?: string;
  readonly checkedAt?: string;
};

export type GuardedActionOutput<TOutput> =
  | {
      readonly status: "accepted";
      readonly output: TOutput;
      readonly guard: UndergroundGuardResult;
    }
  | {
      readonly status: "fallback";
      readonly output: TOutput;
      readonly guard: UndergroundGuardResult;
      readonly fallbackSourceRefs: readonly string[];
    }
  | {
      readonly status: "rejected";
      readonly guard: UndergroundGuardResult;
      readonly rejectedOutput?: TOutput;
    };

export function createGuardViolation(input: {
  readonly code: string;
  readonly message: string;
  readonly severity?: UndergroundGuardSeverity;
  readonly sourceRef?: string;
}): UndergroundGuardViolation {
  return {
    code: input.code,
    message: input.message,
    severity: input.severity ?? "error",
    sourceRef: input.sourceRef,
  };
}

export function createGuardResult(input: {
  readonly violations?: readonly UndergroundGuardViolation[];
  readonly fallbackReason?: string;
  readonly checkedAt?: string;
} = {}): UndergroundGuardResult {
  const violations = input.violations ?? [];
  return {
    passed: violations.every((violation) => violation.severity !== "error"),
    violations: [...violations],
    fallbackReason: input.fallbackReason,
    checkedAt: input.checkedAt,
  };
}

export function acceptGuardedAction<TOutput>(
  output: TOutput,
  guard: UndergroundGuardResult = createGuardResult()
): GuardedActionOutput<TOutput> {
  if (!guard.passed) {
    return {
      status: "rejected",
      guard,
      rejectedOutput: output,
    };
  }
  return {
    status: "accepted",
    output,
    guard,
  };
}

export function fallbackGuardedAction<TOutput>(input: {
  readonly output: TOutput;
  readonly reason: string;
  readonly sourceRefs: readonly string[];
  readonly violations?: readonly UndergroundGuardViolation[];
  readonly checkedAt?: string;
}): GuardedActionOutput<TOutput> {
  return {
    status: "fallback",
    output: input.output,
    fallbackSourceRefs: [...input.sourceRefs],
    guard: createGuardResult({
      violations: input.violations,
      fallbackReason: input.reason,
      checkedAt: input.checkedAt,
    }),
  };
}

export function rejectGuardedAction<TOutput>(input: {
  readonly output?: TOutput;
  readonly violations: readonly UndergroundGuardViolation[];
  readonly checkedAt?: string;
}): GuardedActionOutput<TOutput> {
  return {
    status: "rejected",
    rejectedOutput: input.output,
    guard: createGuardResult({
      violations: input.violations,
      checkedAt: input.checkedAt,
    }),
  };
}

