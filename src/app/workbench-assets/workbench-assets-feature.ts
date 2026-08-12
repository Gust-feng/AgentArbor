import type {
  WorkbenchAsset,
  WorkbenchAssetEvent,
  WorkbenchAssetRepository,
  WorkbenchAssetsFeature,
} from "./contracts.js";

export function createWorkbenchAssetsFeature(repository: WorkbenchAssetRepository): WorkbenchAssetsFeature {
  const listeners = new Set<(event: WorkbenchAssetEvent) => void>();
  let released = false;
  let tail = Promise.resolve();
  const assertActive = (): void => {
    if (released) throw new Error("Workbench Assets feature is released");
  };
  const run = <T>(operation: () => Promise<T>): Promise<T> => {
    assertActive();
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  const publish = (assetId: string): void => {
    for (const listener of [...listeners]) {
      try { listener({ type: "workbench_asset.changed", assetId }); } catch { /* Observers cannot alter a committed asset update. */ }
    }
  };

  return {
    commands: {
      async replace(asset: WorkbenchAsset) {
        await run(async () => {
          await repository.upsertMany([asset]);
          publish(asset.id);
        });
      },
      async updateText(input) {
        return await run(async () => {
          const result = await repository.updateText(input);
          if (result.status === "updated") publish(input.id);
          return result;
        });
      },
    },
    queries: {
      async get(id) { assertActive(); await tail; return await repository.get(id); },
      async list() { assertActive(); await tail; return await repository.list(); },
    },
    events: {
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    },
    async release() {
      if (released) return;
      released = true;
      await tail;
      listeners.clear();
    },
  };
}
