import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemorySessionRepo,
  Session,
  type SessionMetadata,
  type SessionStorage,
  type SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import {
  SessionGenerationError,
  SessionWriteFence,
} from "./session-write-fence.js";

test("SessionWriteFence permits only one concurrent generation", async () => {
  const fixture = await fenceFixture();
  const first = fixture.fence.acquire(fixture.openStorage);
  const second = fixture.fence.acquire(fixture.openStorage);

  const firstLease = await first;
  await assert.rejects(second, hasGenerationCode("generation_active"));
  assert.equal(fixture.openCount(), 1);
  await firstLease.release();
});

test("SessionWriteFence completes an entered write before revoke and rejects later writes", async () => {
  const fixture = await fenceFixture();
  const lease = await fixture.fence.acquire(fixture.openStorage);
  const session = new Session(lease.storage);
  const safeLeafId = await session.appendCustomEntry("safe");
  const gate = manualGate();
  fixture.control.blockNextAppend(gate);

  const enteredWrite = session.appendCustomEntry("entered-before-revoke");
  await fixture.control.appendEntered();
  const revoking = lease.revokeTo(safeLeafId);
  const lateWrite = session.appendCustomEntry("late-after-revoke");
  gate.open();

  await enteredWrite;
  await revoking;
  await assert.rejects(lateWrite, hasGenerationCode("generation_revoked"));
  assert.equal(await fixture.baseStorage.getLeafId(), safeLeafId);
});

test("SessionWriteFence lets a successor reopen after revoke without waiting for old release", async () => {
  const fixture = await fenceFixture();
  const oldLease = await fixture.fence.acquire(fixture.openStorage);
  const oldSession = new Session(oldLease.storage);
  const safeLeafId = await oldSession.appendCustomEntry("safe");
  await oldSession.appendCustomEntry("abandoned");
  await oldLease.revokeTo(safeLeafId);

  const nextLease = await fixture.fence.acquire(fixture.openStorage);
  const nextSession = new Session(nextLease.storage);
  const nextLeafId = await nextSession.appendCustomEntry("successor");

  await assert.rejects(
    oldSession.appendCustomEntry("late-old-write"),
    hasGenerationCode("generation_revoked"),
  );
  await oldLease.release();
  assert.equal(await nextSession.getLeafId(), nextLeafId);
  await nextLease.release();
  assert.equal(fixture.openCount(), 2);
});

test("SessionWriteFence prevents a late old setLeafId from moving a successor branch", async () => {
  const fixture = await fenceFixture();
  const oldLease = await fixture.fence.acquire(fixture.openStorage);
  const oldSession = new Session(oldLease.storage);
  const safeLeafId = await oldSession.appendCustomEntry("safe");
  const abandonedLeafId = await oldSession.appendCustomEntry("abandoned");
  await oldLease.revokeTo(safeLeafId);
  const nextLease = await fixture.fence.acquire(fixture.openStorage);
  const nextSession = new Session(nextLease.storage);
  const nextLeafId = await nextSession.appendCustomEntry("successor");

  await assert.rejects(
    oldSession.getStorage().setLeafId(abandonedLeafId),
    hasGenerationCode("generation_revoked"),
  );
  assert.equal(await nextSession.getLeafId(), nextLeafId);
  await nextLease.release();
});

test("SessionWriteFence keeps a failed restore fenced and allows an explicit retry", async () => {
  const fixture = await fenceFixture();
  const lease = await fixture.fence.acquire(fixture.openStorage);
  const session = new Session(lease.storage);
  const safeLeafId = await session.appendCustomEntry("safe");
  await session.appendCustomEntry("abandoned");
  fixture.control.failNextLeafRestore();

  await assert.rejects(lease.revokeTo(safeLeafId), hasGenerationCode("generation_revoke_failed"));
  await assert.rejects(
    session.appendCustomEntry("late-after-failed-restore"),
    hasGenerationCode("generation_revoke_failed"),
  );
  await assert.rejects(
    fixture.fence.acquire(fixture.openStorage),
    hasGenerationCode("generation_revoke_failed"),
  );
  await assert.rejects(lease.revokeTo(null), hasGenerationCode("generation_revoked"));

  await lease.revokeTo(safeLeafId);
  const nextLease = await fixture.fence.acquire(fixture.openStorage);
  assert.equal(await nextLease.storage.getLeafId(), safeLeafId);
  await nextLease.release();
});

test("SessionWriteFence makes release revoke write access and leaves a successor untouched", async () => {
  const fixture = await fenceFixture();
  const oldLease = await fixture.fence.acquire(fixture.openStorage);
  const oldSession = new Session(oldLease.storage);
  await oldSession.appendCustomEntry("old");
  await Promise.all([oldLease.release(), oldLease.release()]);
  const nextLease = await fixture.fence.acquire(fixture.openStorage);
  const nextSession = new Session(nextLease.storage);
  const nextLeafId = await nextSession.appendCustomEntry("next");

  await assert.rejects(oldSession.appendCustomEntry("late"), hasGenerationCode("generation_revoked"));
  await oldLease.release();
  assert.equal(await nextSession.getLeafId(), nextLeafId);
  await nextLease.release();
});

test("SessionWriteFence makes repeated revoke idempotent and rejects a different target", async () => {
  const fixture = await fenceFixture();
  const lease = await fixture.fence.acquire(fixture.openStorage);
  const session = new Session(lease.storage);
  const safeLeafId = await session.appendCustomEntry("safe");
  await session.appendCustomEntry("abandoned");

  await Promise.all([lease.revokeTo(safeLeafId), lease.revokeTo(safeLeafId)]);
  assert.equal(fixture.control.leafWriteCount(), 1);
  await assert.rejects(lease.revokeTo(null), hasGenerationCode("generation_revoked"));
  assert.equal(fixture.control.leafWriteCount(), 1);
});

test("SessionWriteFence lets a revoke requested beside release own the leaf restore", async () => {
  const fixture = await fenceFixture();
  const lease = await fixture.fence.acquire(fixture.openStorage);
  const session = new Session(lease.storage);
  const safeLeafId = await session.appendCustomEntry("safe");
  await session.appendCustomEntry("abandoned");

  const releasing = lease.release();
  const revoking = lease.revokeTo(safeLeafId);
  await Promise.all([releasing, revoking]);
  const nextLease = await fixture.fence.acquire(fixture.openStorage);
  assert.equal(await nextLease.storage.getLeafId(), safeLeafId);
  await nextLease.release();
});

test("SessionWriteFence refuses to publish a reopened storage with the wrong leaf", async () => {
  const fixture = await fenceFixture();
  const lease = await fixture.fence.acquire(fixture.openStorage);
  const session = new Session(lease.storage);
  const safeLeafId = await session.appendCustomEntry("safe");
  await session.appendCustomEntry("abandoned");
  await lease.revokeTo(safeLeafId);
  fixture.control.reportNextLeafId("unexpected-leaf");

  await assert.rejects(
    fixture.fence.acquire(fixture.openStorage),
    hasGenerationCode("generation_revoke_failed"),
  );
  await assert.rejects(
    fixture.fence.acquire(fixture.openStorage),
    hasGenerationCode("generation_revoke_failed"),
  );
});

test("SessionWriteFence makes a late old revoke unable to move the successor leaf", async () => {
  const fixture = await fenceFixture();
  const oldLease = await fixture.fence.acquire(fixture.openStorage);
  const oldSession = new Session(oldLease.storage);
  const safeLeafId = await oldSession.appendCustomEntry("safe");
  await oldSession.appendCustomEntry("abandoned");
  await oldLease.revokeTo(safeLeafId);
  const nextLease = await fixture.fence.acquire(fixture.openStorage);
  const nextSession = new Session(nextLease.storage);
  const nextLeafId = await nextSession.appendCustomEntry("successor");
  const leafWritesBefore = fixture.control.leafWriteCount();

  await oldLease.revokeTo(safeLeafId);
  await assert.rejects(oldLease.revokeTo(null), hasGenerationCode("generation_revoked"));
  assert.equal(fixture.control.leafWriteCount(), leafWritesBefore);
  assert.equal(await nextSession.getLeafId(), nextLeafId);
  await nextLease.release();
});

async function fenceFixture() {
  const session = await new InMemorySessionRepo().create({ id: "fenced-session" });
  const baseStorage = session.getStorage();
  const control = new ControlledSessionStorage(baseStorage);
  const fence = new SessionWriteFence();
  let opens = 0;
  return {
    baseStorage,
    control,
    fence,
    openStorage: async () => {
      opens += 1;
      return control;
    },
    openCount: () => opens,
  };
}

class ControlledSessionStorage implements SessionStorage<SessionMetadata> {
  private appendGate?: ReturnType<typeof manualGate>;
  private appendEnteredGate = manualGate();
  private rejectNextLeafRestore = false;
  private nextReportedLeafId?: string | null;
  private leafWrites = 0;

  constructor(private readonly inner: SessionStorage<SessionMetadata>) {}

  blockNextAppend(gate: ReturnType<typeof manualGate>): void {
    this.appendGate = gate;
    this.appendEnteredGate = manualGate();
  }

  appendEntered(): Promise<void> {
    return this.appendEnteredGate.entered;
  }

  failNextLeafRestore(): void {
    this.rejectNextLeafRestore = true;
  }

  leafWriteCount(): number {
    return this.leafWrites;
  }

  reportNextLeafId(leafId: string | null): void {
    this.nextReportedLeafId = leafId;
  }

  getMetadata(): Promise<SessionMetadata> { return this.inner.getMetadata(); }
  getLeafId(): Promise<string | null> {
    if (this.nextReportedLeafId !== undefined) {
      const leafId = this.nextReportedLeafId;
      this.nextReportedLeafId = undefined;
      return Promise.resolve(leafId);
    }
    return this.inner.getLeafId();
  }
  createEntryId(): Promise<string> { return this.inner.createEntryId(); }
  getEntry(id: string): Promise<SessionTreeEntry | undefined> { return this.inner.getEntry(id); }
  getLabel(id: string): Promise<string | undefined> { return this.inner.getLabel(id); }
  getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> { return this.inner.getPathToRoot(leafId); }
  getEntries(): Promise<SessionTreeEntry[]> { return this.inner.getEntries(); }

  async setLeafId(leafId: string | null): Promise<void> {
    if (this.rejectNextLeafRestore) {
      this.rejectNextLeafRestore = false;
      throw new Error("simulated leaf restore failure");
    }
    this.leafWrites += 1;
    await this.inner.setLeafId(leafId);
  }

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    const gate = this.appendGate;
    if (gate !== undefined) {
      this.appendGate = undefined;
      this.appendEnteredGate.open();
      await gate.entered;
    }
    await this.inner.appendEntry(entry);
  }

  findEntries<TType extends SessionTreeEntry["type"]>(
    type: TType,
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
    return this.inner.findEntries(type);
  }
}

function hasGenerationCode(code: SessionGenerationError["code"]): (error: unknown) => boolean {
  return (error) => error instanceof SessionGenerationError && error.code === code;
}

function manualGate(): { readonly entered: Promise<void>; open(): void } {
  let open!: () => void;
  const entered = new Promise<void>((resolve) => { open = resolve; });
  return { entered, open };
}
