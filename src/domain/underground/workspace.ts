export type WorkspaceSnapshot<TData extends object = Readonly<Record<string, unknown>>> = {
  readonly traceId: string;
  readonly goalId?: string;
  readonly goal?: string;
  readonly data: Readonly<TData>;
};

export type WorkspaceView<TSnapshot extends WorkspaceSnapshot = WorkspaceSnapshot> = {
  snapshot(): TSnapshot;
};

export type WritableWorkspace<TSnapshot extends WorkspaceSnapshot = WorkspaceSnapshot> =
  WorkspaceView<TSnapshot> & {
    replace(agentId: string, snapshot: TSnapshot): void;
    patch(agentId: string, patch: Partial<TSnapshot>): void;
  };

export class InMemoryWorkspace<TSnapshot extends WorkspaceSnapshot = WorkspaceSnapshot>
  implements WritableWorkspace<TSnapshot>
{
  private current: TSnapshot;

  constructor(initialSnapshot: TSnapshot) {
    this.current = cloneWorkspaceSnapshot(initialSnapshot);
  }

  snapshot(): TSnapshot {
    return cloneWorkspaceSnapshot(this.current);
  }

  replace(_agentId: string, snapshot: TSnapshot): void {
    this.current = cloneWorkspaceSnapshot(snapshot);
  }

  patch(_agentId: string, patch: Partial<TSnapshot>): void {
    this.current = cloneWorkspaceSnapshot({
      ...this.current,
      ...patch,
      data: patch.data ?? this.current.data,
    } as TSnapshot);
  }
}

export function createWorkspaceView<TSnapshot extends WorkspaceSnapshot>(
  snapshot: TSnapshot
): WorkspaceView<TSnapshot> {
  const workspace = new InMemoryWorkspace(snapshot);
  return {
    snapshot: () => workspace.snapshot(),
  };
}

export function cloneWorkspaceSnapshot<TSnapshot extends WorkspaceSnapshot>(snapshot: TSnapshot): TSnapshot {
  return globalThis.structuredClone(snapshot);
}
