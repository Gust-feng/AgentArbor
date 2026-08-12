import { useEffect, useRef, type RefObject } from "react";

import { useMobileBackHandler } from "./use-mobile-back-handler";

// Only the visually topmost modal may trap focus or consume Escape.
const focusLayers: HTMLElement[] = [];

export function useModalFocus<T extends HTMLElement>(onRequestClose: () => void, backPriority = 100): RefObject<T | null> {
  const containerRef = useRef<T>(null);
  const closeRef = useRef(onRequestClose);
  closeRef.current = onRequestClose;

  useMobileBackHandler(() => {
    closeRef.current();
    return true;
  }, backPriority);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const container = containerRef.current;
    if (container === null) return;
    focusLayers.push(container);

    const focusableSelector = [
      "button:not([disabled])",
      "input:not([disabled])",
      "textarea:not([disabled])",
      "select:not([disabled])",
      "a[href]",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    const initial = container.querySelector<HTMLElement>("[data-modal-initial]")
      ?? container.querySelector<HTMLElement>(focusableSelector);
    initial?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (focusLayers[focusLayers.length - 1] !== container) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...container.querySelectorAll<HTMLElement>(focusableSelector)]
        .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const layerIndex = focusLayers.lastIndexOf(container);
      if (layerIndex >= 0) focusLayers.splice(layerIndex, 1);
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  return containerRef;
}
