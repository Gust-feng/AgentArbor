export type PanelPersistenceChains = Map<string, Promise<void>>;

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
  persist: () => Promise<void>
): void {
  const previous = chains.get(runId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(persist);
  const tracked = current.then(() => undefined, () => undefined);
  chains.set(runId, tracked);
  void current.finally(() => {
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
