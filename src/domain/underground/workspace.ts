export type WorkspaceSnapshot<T> = {
  readonly traceId: string;
  readonly goalId: string;
  readonly goal: string;
  readonly data: T;
};

export interface WorkspaceView<T> {
  snapshot(): T;
}

export interface WritableWorkspace<T> extends WorkspaceView<T> {
  patch(agentId: string, update: Partial<T>): void;
  replace(agentId: string, snapshot: T): void;
}

export class InMemoryWorkspace<T> implements WritableWorkspace<T> {
  private state: T;

  constructor(init: T) {
    this.state = globalThis.structuredClone(init);
  }

  snapshot(): T {
    return globalThis.structuredClone(this.state);
  }

  patch(agentId: string, update: Partial<T>): void {
    this.state = { ...this.state, ...update };
  }

  replace(agentId: string, snapshot: T): void {
    this.state = globalThis.structuredClone(snapshot);
  }
}

export function createWorkspaceView<T extends WorkspaceSnapshot<unknown>>(
  init: Omit<T, "goalId" | "goal"> & { goalId?: string; goal?: string }
): WorkspaceView<T> {
  const workspace = new InMemoryWorkspace<T>({
    ...init,
    goalId: init.goalId ?? "",
    goal: init.goal ?? "",
  } as T);
  return { snapshot: workspace.snapshot.bind(workspace) };
}

export function createWorkspaceProjectionView<T>(snapshot: T): WorkspaceView<T> {
  const base = globalThis.structuredClone(snapshot);
  return {
    snapshot: () => globalThis.structuredClone(base),
  };
}
