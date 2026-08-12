export type RemoteAccountConnectionStatus = {
  readonly state: "unregistered" | "pairing" | "connecting" | "connected" | "offline";
  readonly accountId?: string;
};

export function bindRemoteAccountContentVaultSync(input: {
  readonly initialStatus: RemoteAccountConnectionStatus;
  readonly subscribe: (listener: (status: RemoteAccountConnectionStatus) => void) => () => void;
  readonly sync: {
    readonly start: () => void;
    readonly stop: () => Promise<void>;
    readonly clearAccount: (accountId: string) => Promise<void>;
  };
  readonly onError?: (operation: "stop" | "clear_account", error: unknown) => void;
}): () => void {
  let accountId = input.initialStatus.accountId;
  let syncActive = false;

  const start = (): void => {
    if (syncActive) return;
    syncActive = true;
    input.sync.start();
  };
  const stop = (): void => {
    if (!syncActive) return;
    syncActive = false;
    void input.sync.stop().catch((error: unknown) => input.onError?.("stop", error));
  };

  if (accountId !== undefined && input.initialStatus.state !== "unregistered") start();

  return input.subscribe((status) => {
    if (status.state === "unregistered") {
      const removedAccountId = accountId ?? status.accountId;
      accountId = undefined;
      syncActive = false;
      if (removedAccountId === undefined) {
        void input.sync.stop().catch((error: unknown) => input.onError?.("stop", error));
      } else {
        void input.sync.clearAccount(removedAccountId)
          .catch((error: unknown) => input.onError?.("clear_account", error));
      }
      return;
    }
    if (status.accountId === undefined) {
      accountId = undefined;
      stop();
      return;
    }
    accountId = status.accountId;
    start();
  });
}
