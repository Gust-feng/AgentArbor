import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionGateway,
  ToolExecutionPreflight,
  ToolExecutor,
  ToolOperationType,
  ToolPermissionCheck,
  ToolExecutionMetricsSink,
} from "../../domain/tools/index.js";

type ReadBatch = {
  readonly predecessor: Promise<void>;
  readonly completion: Promise<void>;
  readonly release: () => void;
  pending: number;
};

type RegisteredCall = {
  readonly factId: string;
  preflight: "pending" | "ready" | "skipped";
  invocation?: {
    readonly request: ToolCallRequest;
    readonly context: ToolExecutionContext;
    readonly permission: ToolPermissionCheck;
    readonly queuedAt: number;
    readonly resolve: (result: ToolCallResult) => void;
    readonly reject: (error: unknown) => void;
    readonly detachAbort: () => void;
  };
};

/**
 * Run-scoped read/write barrier for Ordinary SDK tool callbacks.
 * Consecutive reads share a barrier; every non-read-only call is an exclusive FIFO barrier.
 */
export class OrderedToolExecutionGateway implements ToolExecutionGateway {
  private readonly operationByName: Map<string, ToolOperationType>;
  private readonly registeredCalls: RegisteredCall[] = [];
  private readonly registeredByFactId = new Map<string, RegisteredCall>();
  private registeredCursor = 0;
  private tail: Promise<void> = Promise.resolve();
  private activeReadBatch: ReadBatch | undefined;
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private activeCount = 0;

  constructor(
    private readonly inner: ToolExecutionGateway,
    private readonly metricsSink?: ToolExecutionMetricsSink,
  ) {
    this.operationByName = new Map(inner.list().map((definition) => [
      definition.name,
      definition.metadata?.operationType ?? "read-write",
    ]));
  }

  list(): ToolDefinition[] {
    return this.inner.list();
  }

  has(name: string): boolean {
    return this.inner.has(name);
  }

  register(executor: ToolExecutor): void {
    this.inner.register?.(executor);
    this.operationByName.set(
      executor.definition.name,
      executor.definition.metadata?.operationType ?? "read-write",
    );
  }

  deliverResult(
    result: ToolCallResult,
    permission: ToolPermissionCheck,
    ownerId: string,
  ): Promise<ToolCallResult> {
    return this.inner.deliverResult?.(result, permission, ownerId) ?? Promise.resolve(result);
  }

  /**
   * Freezes provider order before SDK preflight callbacks can race. Calls that
   * pause for approval are skipped here; an approved continuation later enters
   * as a new actual execution request in arrival order.
   */
  registerToolRound(toolCalls: readonly ToolCallRequest[]): void {
    if (this.closed) return;
    for (const call of toolCalls) {
      const factId = toolFactId(call);
      if (this.registeredByFactId.has(factId)) continue;
      const registered: RegisteredCall = {
        factId,
        preflight: "pending",
      };
      this.registeredCalls.push(registered);
      this.registeredByFactId.set(factId, registered);
    }
  }

  preflight(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission: ToolPermissionCheck,
  ): ToolExecutionPreflight {
    if (this.closed) return closedPreflight(request);
    const result = this.inner.preflight(request, context, permission);
    const registered = this.registeredByFactId.get(toolFactId(request));
    if (registered !== undefined && registered.preflight === "pending") {
      registered.preflight = result.status === "ready" ? "ready" : "skipped";
      this.drainRegisteredCalls();
    }
    return result;
  }

  async execute(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission: ToolPermissionCheck,
  ): Promise<ToolCallResult> {
    if (this.closed) return closedResult(request);
    const registered = this.registeredByFactId.get(toolFactId(request));
    if (
      registered !== undefined &&
      registered.preflight !== "skipped" &&
      registered.invocation === undefined
    ) {
      return new Promise<ToolCallResult>((resolve, reject) => {
        const abortSignal = context.abortSignal;
        const onAbort = () => this.cancelRegisteredCall(registered);
        abortSignal?.addEventListener("abort", onAbort, { once: true });
        registered.invocation = {
          request,
          context,
          permission,
          queuedAt: Date.now(),
          resolve,
          reject,
          detachAbort: () => abortSignal?.removeEventListener("abort", onAbort),
        };
        if (abortSignal?.aborted === true) onAbort();
        this.drainRegisteredCalls();
      });
    }
    return this.executeByOperation(request, context, permission);
  }

  close(): Promise<void> {
    this.closed = true;
    for (let index = this.registeredCursor; index < this.registeredCalls.length; index += 1) {
      const registered = this.registeredCalls[index]!;
      if (registered.invocation !== undefined) {
        registered.invocation.detachAbort();
        registered.invocation.resolve(closedResult(registered.invocation.request));
      }
      this.registeredByFactId.delete(registered.factId);
      registered.preflight = "skipped";
    }
    this.registeredCursor = this.registeredCalls.length;
    this.closePromise ??= Promise.resolve().then(() => this.tail).catch(() => undefined);
    return this.closePromise;
  }

  private executeByOperation(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission: ToolPermissionCheck,
  ): Promise<ToolCallResult> {
    return this.isReadOnly(request.toolName)
      ? this.executeRead(request, context, permission)
      : this.executeExclusive(request, context, permission);
  }

  private drainRegisteredCalls(): void {
    while (this.registeredCursor < this.registeredCalls.length) {
      const registered = this.registeredCalls[this.registeredCursor]!;
      if (registered.preflight === "pending") return;
      if (registered.preflight === "skipped") {
        this.registeredByFactId.delete(registered.factId);
        this.registeredCursor += 1;
        continue;
      }
      const invocation = registered.invocation;
      if (invocation === undefined) return;
      invocation.detachAbort();
      this.registeredByFactId.delete(registered.factId);
      this.registeredCursor += 1;
      this.executeByOperation(invocation.request, invocation.context, invocation.permission)
        .then(invocation.resolve, invocation.reject);
    }
  }

  private cancelRegisteredCall(registered: RegisteredCall): void {
    const invocation = registered.invocation;
    if (invocation === undefined || !this.registeredByFactId.has(registered.factId)) return;
    invocation.detachAbort();
    registered.preflight = "skipped";
    this.recordQueuedCancellation(invocation.request, invocation.queuedAt);
    invocation.resolve(cancelledBeforeExecution(invocation.request, "tool_cancelled_while_queued"));
    this.drainRegisteredCalls();
  }

  private async executeRead(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission: ToolPermissionCheck,
  ): Promise<ToolCallResult> {
    const batch = this.activeReadBatch ?? this.createReadBatch();
    batch.pending += 1;
    const queuedAt = Date.now();
    await batch.predecessor;
    if (this.closed || context.abortSignal?.aborted === true) {
      this.recordQueuedCancellation(request, queuedAt);
      this.releaseReadBatch(batch);
      return cancelledBeforeExecution(request, this.closed ? "ordinary_tool_gateway_closed" : "tool_cancelled_while_queued");
    }
    const startedAt = Date.now();
    this.activeCount += 1;
    try {
      return await this.inner.execute(request, context, permission);
    } finally {
      this.recordScheduling(request, queuedAt, startedAt);
      this.activeCount -= 1;
      this.releaseReadBatch(batch);
    }
  }

  private async executeExclusive(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission: ToolPermissionCheck,
  ): Promise<ToolCallResult> {
    this.activeReadBatch = undefined;
    const predecessor = this.tail;
    const queuedAt = Date.now();
    let release!: () => void;
    const completion = new Promise<void>((resolve) => { release = resolve; });
    this.tail = predecessor.then(() => completion).then(() => undefined);
    await predecessor;
    if (this.closed || context.abortSignal?.aborted === true) {
      this.recordQueuedCancellation(request, queuedAt);
      release();
      return cancelledBeforeExecution(request, this.closed ? "ordinary_tool_gateway_closed" : "tool_cancelled_while_queued");
    }
    const startedAt = Date.now();
    this.activeCount += 1;
    try {
      return await this.inner.execute(request, context, permission);
    } finally {
      this.recordScheduling(request, queuedAt, startedAt);
      this.activeCount -= 1;
      release();
    }
  }

  private createReadBatch(): ReadBatch {
    const predecessor = this.tail;
    let release!: () => void;
    const completion = new Promise<void>((resolve) => { release = resolve; });
    const batch: ReadBatch = { predecessor, completion, release, pending: 0 };
    this.activeReadBatch = batch;
    this.tail = completion;
    return batch;
  }

  private releaseReadBatch(batch: ReadBatch): void {
    batch.pending -= 1;
    if (batch.pending === 0) {
      batch.release();
      if (this.activeReadBatch === batch) this.activeReadBatch = undefined;
    }
  }

  private isReadOnly(toolName: string): boolean {
    return this.operationByName.get(toolName) === "read-only";
  }

  private recordScheduling(request: ToolCallRequest, queuedAt: number, startedAt: number): void {
    try {
      this.metricsSink?.record({
        kind: "scheduling",
        toolName: request.toolName,
        operationType: this.operationByName.get(request.toolName) ?? "read-write",
        queueWaitMs: Math.max(0, startedAt - queuedAt),
        executionMs: Math.max(0, Date.now() - startedAt),
        activeCount: this.activeCount,
      });
    } catch {
      try {
        this.metricsSink?.recordDropped?.();
      } catch {
        // Scheduling metrics cannot change a tool result.
      }
    }
  }

  private recordQueuedCancellation(request: ToolCallRequest, queuedAt: number): void {
    try {
      this.metricsSink?.record({
        kind: "scheduling",
        toolName: request.toolName,
        operationType: this.operationByName.get(request.toolName) ?? "read-write",
        queueWaitMs: Math.max(0, Date.now() - queuedAt),
        executionMs: 0,
        activeCount: this.activeCount,
        cancelledWhileQueued: true,
      });
    } catch {
      try {
        this.metricsSink?.recordDropped?.();
      } catch {
        // Metrics remain observational even when both sink callbacks fail.
      }
    }
  }
}

function toolFactId(request: ToolCallRequest): string {
  return request.factId ?? request.callId;
}

function closedPreflight(request: ToolCallRequest): Extract<ToolExecutionPreflight, { readonly status: "blocked" }> {
  return { status: "blocked", result: closedResult(request) };
}

function closedResult(request: ToolCallRequest): ToolCallResult & { readonly status: "cancelled" } {
  return cancelledBeforeExecution(request, "ordinary_tool_gateway_closed");
}

function cancelledBeforeExecution(
  request: ToolCallRequest,
  code: string,
): ToolCallResult & { readonly status: "cancelled" } {
  return {
    ...request,
    output: undefined,
    status: "cancelled",
    error: "Tool execution was cancelled before entering its executor.",
    errorDomain: "runtime_error",
    errorFacts: { code, sourceExecutionStatus: "not_started", retryable: false },
    durationMs: 0,
  };
}
