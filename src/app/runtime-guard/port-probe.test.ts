import assert from "node:assert/strict";
import { createServer as createNetServer, type Server } from "node:net";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { probeLocalPort, waitForLocalPort, type PortOccupantProbe } from "./port-probe.js";

test("waitForLocalPort returns ready facts for a temporary local server", async () => {
  const server = createNetServer();
  try {
    const port = await listenOnUnusedLocalPort(server);

    const fact = await waitForLocalPort({
      port,
      timeoutMs: 1_000,
      probeTimeoutMs: 100,
      pollIntervalMs: 10,
    });

    assert.equal(fact.kind, "wait");
    assert.equal(fact.port, port);
    assert.equal(fact.host, "127.0.0.1");
    assert.equal(fact.status, "ready");
    assert.equal(fact.ready, true);
    assert.equal(fact.cancelled, undefined);
    assert.equal(fact.timedOut, undefined);
    assert.equal(typeof fact.requestedAt, "string");
    assert.equal(typeof fact.checkedAt, "string");
    assert.equal(fact.attempts >= 1, true);
  } finally {
    await closeServer(server);
  }
});

test("waitForLocalPort returns timeout facts for an unused port", async () => {
  const port = await unusedLocalPort();

  const fact = await waitForLocalPort({
    port,
    timeoutMs: 50,
    probeTimeoutMs: 10,
    pollIntervalMs: 5,
  });

  assert.equal(fact.kind, "wait");
  assert.equal(fact.port, port);
  assert.equal(fact.status, "timeout");
  assert.equal(fact.ready, false);
  assert.equal(fact.timedOut, true);
  assert.equal(fact.cancelled, undefined);
  assert.equal(fact.timeoutMs, 50);
  assert.equal(typeof fact.durationMs, "number");
  assert.equal(fact.error?.code, "ECONNREFUSED");
  assert.equal(fact.attempts >= 1, true);
});

test("probeLocalPort reports refused local ports as not_ready facts", async () => {
  const port = await unusedLocalPort();

  const fact = await probeLocalPort({
    port,
    timeoutMs: 100,
  });

  assert.equal(fact.kind, "probe");
  assert.equal(fact.port, port);
  assert.equal(fact.status, "not_ready");
  assert.equal(fact.ready, false);
  assert.equal(fact.timedOut, undefined);
  assert.equal(fact.error?.code, "ECONNREFUSED");
});

test("waitForLocalPort returns cancelled facts from AbortSignal", async () => {
  const port = await unusedLocalPort();
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 20);
  try {
    const fact = await waitForLocalPort({
      port,
      timeoutMs: 1_000,
      probeTimeoutMs: 100,
      pollIntervalMs: 100,
      abortSignal: controller.signal,
    });

    assert.equal(fact.kind, "wait");
    assert.equal(fact.port, port);
    assert.equal(fact.status, "cancelled");
    assert.equal(fact.ready, false);
    assert.equal(fact.cancelled, true);
    assert.equal(fact.timedOut, undefined);
    assert.equal(fact.error?.code, "ABORT_ERR");
  } finally {
    clearTimeout(abortTimer);
  }
});

test("probeLocalPort preserves injected external occupant facts", async () => {
  const server = createNetServer();
  try {
    const port = await listenOnUnusedLocalPort(server);
    const occupantProbe: PortOccupantProbe = (input) => {
      assert.equal(input.port, port);
      assert.equal(input.host, "127.0.0.1");
      assert.equal(typeof input.observedAt, "string");
      return {
        pid: 12345,
        observedBy: "platform_probe",
      };
    };

    const fact = await probeLocalPort({
      port,
      timeoutMs: 100,
      portOccupantProbe: occupantProbe,
    });

    assert.equal(fact.kind, "probe");
    assert.equal(fact.status, "ready");
    assert.equal(fact.ready, true);
    assert.deepEqual(fact.externalOccupant, {
      pid: 12345,
      observedBy: "platform_probe",
      ownedByUs: false,
    });
  } finally {
    await closeServer(server);
  }
});

test("probeLocalPort keeps ready facts when occupant probing fails", async () => {
  const server = createNetServer();
  try {
    const port = await listenOnUnusedLocalPort(server);

    const fact = await probeLocalPort({
      port,
      timeoutMs: 100,
      portOccupantProbe() {
        throw new Error("platform probe failed");
      },
    });

    assert.equal(fact.status, "ready");
    assert.equal(fact.ready, true);
    assert.equal(fact.externalOccupant, undefined);
  } finally {
    await closeServer(server);
  }
});

test("waitForLocalPort preserves injected external occupant facts on ready ports", async () => {
  const server = createNetServer();
  try {
    const port = await listenOnUnusedLocalPort(server);
    const occupantProbe: PortOccupantProbe = () => ({
      pid: 12346,
      observedBy: "platform_probe",
    });

    const fact = await waitForLocalPort({
      port,
      timeoutMs: 1_000,
      probeTimeoutMs: 100,
      pollIntervalMs: 10,
      portOccupantProbe: occupantProbe,
    });

    assert.equal(fact.status, "ready");
    assert.equal(fact.ready, true);
    assert.deepEqual(fact.externalOccupant, {
      pid: 12346,
      observedBy: "platform_probe",
      ownedByUs: false,
    });
  } finally {
    await closeServer(server);
  }
});

async function unusedLocalPort(): Promise<number> {
  const server = createNetServer();
  const port = await listenOnUnusedLocalPort(server);
  await closeServer(server);
  await delay(5);
  return port;
}

function listenOnUnusedLocalPort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : undefined;
      if (port === undefined) {
        reject(new Error("Could not allocate local port."));
        return;
      }
      resolve(port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
