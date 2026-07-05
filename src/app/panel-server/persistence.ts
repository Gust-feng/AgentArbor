export type PanelPersistenceChains = Map<string, Promise<void>>;

export type PanelPersistenceFailureHandler = (error: unknown) => void;

export async function enqueuePanelPersistence(
  chains: PanelPersistenceChains,
  runId: string,
  persist: () => Promise<void>
): Promise<void> {
  const previous = chains.get(runId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(persist);
  const tracked = current.then(() => undefined, () => undefined);
  chains.set(runId, tracked);
  try {
    await current;
  } finally {
    if (chains.get(runId) === tracked) {
      chains.delete(runId);
    }
  }
}

export function enqueuePanelPersistenceBackground(
  chains: PanelPersistenceChains,
  runId: string,
  persist: () => Promise<void>,
  onFailure?: PanelPersistenceFailureHandler
): void {
  const previous = chains.get(runId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(persist);
  const tracked = current.then(() => undefined, () => undefined);
  chains.set(runId, tracked);
  void current.catch((error: unknown) => {
    reportBackgroundPersistenceFailure(error, onFailure);
  });
  void tracked.then(() => {
    if (chains.get(runId) === tracked) {
      chains.delete(runId);
    }
  });
}

export async function waitForPanelPersistenceIdle(chains: PanelPersistenceChains): Promise<void> {
  while (chains.size > 0) {
    await Promise.allSettled([...chains.values()]);
  }
}

function reportBackgroundPersistenceFailure(
  error: unknown,
  onFailure: PanelPersistenceFailureHandler | undefined
): void {
  if (onFailure === undefined) {
    console.error("[panel-persistence] background persistence failed", error);
    return;
  }
  try {
    onFailure(error);
  } catch (reportError) {
    console.error("[panel-persistence] background persistence failure reporter failed", reportError);
    console.error("[panel-persistence] original background persistence failure", error);
  }
}
