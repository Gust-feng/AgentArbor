import path from "node:path";

export interface LocalWorkspaceMutationCoordinator {
  run<T>(absolutePath: string, operation: () => Promise<T>): Promise<T>;
}

/** Serializes mutations of one filesystem path while leaving other paths independent. */
export class InMemoryLocalWorkspaceMutationCoordinator implements LocalWorkspaceMutationCoordinator {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(absolutePath: string, operation: () => Promise<T>): Promise<T> {
    const key = mutationKey(absolutePath);
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate, () => gate);
    this.tails.set(key, tail);

    return (async () => {
      await previous.catch(() => undefined);
      try {
        return await operation();
      } finally {
        release();
        if (this.tails.get(key) === tail) this.tails.delete(key);
      }
    })();
  }
}

function mutationKey(absolutePath: string): string {
  const normalized = path.normalize(path.resolve(absolutePath));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
