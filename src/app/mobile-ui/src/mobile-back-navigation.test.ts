import { describe, expect, test } from "vitest";

import { dispatchMobileBackButton, registerMobileBackHandler } from "./mobile-back-navigation";

describe("mobile back navigation", () => {
  test("dispatches a higher-priority visual layer before registration order", () => {
    const calls: string[] = [];
    const removeHigh = registerMobileBackHandler(() => {
      calls.push("high");
      return true;
    }, 100);
    const removeLow = registerMobileBackHandler(() => {
      calls.push("low");
      return true;
    });

    try {
      expect(dispatchMobileBackButton()).toBe(true);
      expect(calls).toEqual(["high"]);
    } finally {
      removeLow();
      removeHigh();
    }
  });

  test("keeps last-mounted-first behavior within the same priority", () => {
    const calls: string[] = [];
    const removeFirst = registerMobileBackHandler(() => {
      calls.push("first");
      return true;
    });
    const removeSecond = registerMobileBackHandler(() => {
      calls.push("second");
      return true;
    });

    try {
      expect(dispatchMobileBackButton()).toBe(true);
      expect(calls).toEqual(["second"]);
    } finally {
      removeSecond();
      removeFirst();
    }
  });
});
