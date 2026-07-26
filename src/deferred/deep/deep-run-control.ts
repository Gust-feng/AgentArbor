/**
 * Deep run 的 step 间控制协议。terminal 信号优先于 correction，correction 在读取后消费，
 * 因而不会在多个 manager step 中重复注入同一段纠正上下文。
 */
export type DeepRunControlSignal =
  | { readonly kind: "none" }
  | { readonly kind: "correct"; readonly correctionContext: readonly string[]; readonly reason?: string }
  | { readonly kind: "interrupt"; readonly reason?: string }
  | { readonly kind: "stop"; readonly reason?: string };

export type DeepRunControlHandle = {
  readonly consume: () => DeepRunControlSignal;
  readonly requestInterrupt: (reason?: string) => void;
  readonly requestCorrect: (correctionContext: readonly string[], reason?: string) => void;
  readonly requestStop: (reason?: string) => void;
};

export type DeepRunControlEvent =
  | {
      readonly kind: "interrupt";
      readonly atStepIndex: number;
      readonly recordedAt: string;
      readonly reason?: string;
      readonly preservedChildRuns: number;
      readonly preservedMaterials: number;
    }
  | {
      readonly kind: "correct";
      readonly atStepIndex: number;
      readonly recordedAt: string;
      readonly correctionContext: readonly string[];
      readonly reason?: string;
    }
  | {
      readonly kind: "stop";
      readonly atStepIndex: number;
      readonly recordedAt: string;
      readonly reason?: string;
      readonly partialSynthesis: boolean;
    };

export function createDeepRunControlHandle(): DeepRunControlHandle {
  let terminal: { readonly kind: "interrupt" | "stop"; readonly reason?: string } | undefined;
  let pendingCorrect:
    | { readonly correctionContext: readonly string[]; readonly reason?: string }
    | undefined;
  return {
    consume(): DeepRunControlSignal {
      if (terminal) {
        return terminal.kind === "interrupt"
          ? { kind: "interrupt", reason: terminal.reason }
          : { kind: "stop", reason: terminal.reason };
      }
      if (pendingCorrect) {
        const consumed = pendingCorrect;
        pendingCorrect = undefined;
        return {
          kind: "correct",
          correctionContext: consumed.correctionContext,
          reason: consumed.reason,
        };
      }
      return { kind: "none" };
    },
    requestInterrupt(reason?: string): void {
      if (!terminal) {
        terminal = { kind: "interrupt", reason };
      }
    },
    requestCorrect(correctionContext: readonly string[], reason?: string): void {
      if (!terminal) {
        pendingCorrect = { correctionContext, reason };
      }
    },
    requestStop(reason?: string): void {
      if (!terminal) {
        terminal = { kind: "stop", reason };
      }
    },
  };
}
