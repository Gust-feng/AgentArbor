import path from "node:path";

export interface LocalWorkspaceMutationCoordinator {
  run<T>(absolutePath: string, operation: () => Promise<T>): Promise<T>;
}

type PendingMutation = {
  readonly path: string;
  readonly execute: () => Promise<void>;
  active: boolean;
};

/** FIFO path leases: a directory conflicts with every descendant, while siblings remain independent. */
export class InMemoryLocalWorkspaceMutationCoordinator implements LocalWorkspaceMutationCoordinator {
  private readonly queue: PendingMutation[] = [];

  run<T>(absolutePath: string, operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        path: mutationPath(absolutePath),
        active: false,
        execute: async () => {
          try { resolve(await operation()); } catch (error) { reject(error); }
        },
      });
      this.drain();
    });
  }

  private drain(): void {
    for (let index = 0; index < this.queue.length; index += 1) {
      const candidate = this.queue[index]!;
      if (candidate.active) continue;
      const blockedByActive = this.queue.some((entry) => entry.active && pathsOverlap(entry.path, candidate.path));
      const blockedByEarlier = this.queue.slice(0, index).some((entry) => !entry.active && pathsOverlap(entry.path, candidate.path));
      if (blockedByActive || blockedByEarlier) continue;
      candidate.active = true;
      void candidate.execute().finally(() => {
        const current = this.queue.indexOf(candidate);
        if (current >= 0) this.queue.splice(current, 1);
        this.drain();
      });
    }
  }
}

function mutationPath(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathsOverlap(left: string, right: string): boolean {
  return isSameOrDescendant(left, right) || isSameOrDescendant(right, left);
}

function isSameOrDescendant(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative.length === 0 || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
