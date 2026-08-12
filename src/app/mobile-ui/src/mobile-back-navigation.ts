import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

type MobileBackHandler = () => boolean;
type RegisteredMobileBackHandler = {
  readonly handler: MobileBackHandler;
  readonly priority: number;
  readonly sequence: number;
};

const handlers: RegisteredMobileBackHandler[] = [];
let nativeListenerStarted = false;
let nextSequence = 0;

export function registerMobileBackHandler(handler: MobileBackHandler, priority = 0): () => void {
  const registration = { handler, priority, sequence: nextSequence };
  nextSequence += 1;
  handlers.push(registration);
  startNativeListener();
  return () => {
    const index = handlers.lastIndexOf(registration);
    if (index >= 0) handlers.splice(index, 1);
  };
}

export function dispatchMobileBackButton(): boolean {
  // Visual nesting wins; sequence preserves LIFO behavior among peer layers.
  const ordered = [...handlers].sort((left, right) =>
    right.priority - left.priority || right.sequence - left.sequence);
  for (const registration of ordered) {
    if (registration.handler()) return true;
  }
  return false;
}

function startNativeListener(): void {
  if (nativeListenerStarted || !Capacitor.isNativePlatform()) return;
  nativeListenerStarted = true;
  void CapacitorApp.addListener("backButton", () => {
    if (!dispatchMobileBackButton()) void CapacitorApp.exitApp();
  });
}
