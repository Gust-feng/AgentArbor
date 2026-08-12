import { useEffect, useRef } from "react";

import { registerMobileBackHandler } from "./mobile-back-navigation";

export function useMobileBackHandler(handler: () => boolean, priority = 0): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => registerMobileBackHandler(() => handlerRef.current(), priority), [priority]);
}
