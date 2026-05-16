import React, { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

export type ProceduralGrassInputPhase = "idle" | "focused" | "sending";

export interface ProceduralGrassInputProps {
  readonly value: string;
  readonly active: boolean;
  readonly phase?: ProceduralGrassInputPhase;
  readonly className?: string;
  readonly children: React.ReactNode;
}

const GRASS_LINE_IMAGE = new URL("../../../../../images/grass_transparent_bg.png", import.meta.url).href;
const GRASS_GROWTH = {
  duration: 0.9,
  ease: [0.22, 1, 0.36, 1] as const,
};

function classNames(...values: readonly (string | false | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}

export function ProceduralGrassInput({
  value,
  active,
  phase = "idle",
  className,
  children,
}: ProceduralGrassInputProps): React.ReactElement {
  const shouldReduceMotion = useReducedMotion();
  const previousValue = useRef(value);
  const [typingPulse, setTypingPulse] = useState(false);

  useEffect(() => {
    if (previousValue.current === value) {
      return;
    }
    previousValue.current = value;
    if (value.length === 0 || shouldReduceMotion) {
      setTypingPulse(false);
      return;
    }
    setTypingPulse(true);
    const timeout = window.setTimeout(() => setTypingPulse(false), 180);
    return () => window.clearTimeout(timeout);
  }, [shouldReduceMotion, value]);

  return (
    <div className={classNames("chat-input-card procedural-grass-input", active && "focused", phase === "sending" && "sending", className)}>
      <div aria-hidden="true" className="procedural-grass-stage">
        <motion.div
          className="procedural-grass-mask"
          initial={shouldReduceMotion ? false : { clipPath: "inset(100% 0 0 0)" }}
          animate={{ clipPath: "inset(0% 0 0 0)" }}
          transition={{ duration: shouldReduceMotion ? 0 : GRASS_GROWTH.duration, ease: GRASS_GROWTH.ease }}
        >
          <motion.div
            className="procedural-grass-line-image"
            style={{ backgroundImage: `url("${GRASS_LINE_IMAGE}")` }}
            initial={shouldReduceMotion ? false : { scaleY: 0.9 }}
            animate={
              typingPulse
                ? { scaleY: [1, 0.992, 1.006, 1] }
                : active && !shouldReduceMotion
                  ? { scaleY: [1, 1.006, 1] }
                  : { scaleY: 1 }
            }
            transition={
              typingPulse
                ? { duration: 0.38, ease: GRASS_GROWTH.ease }
                : active && !shouldReduceMotion
                  ? { duration: 4.8, ease: "easeInOut", repeat: Infinity }
                  : { duration: GRASS_GROWTH.duration, ease: GRASS_GROWTH.ease }
            }
          />
        </motion.div>
      </div>
      {children}
    </div>
  );
}
