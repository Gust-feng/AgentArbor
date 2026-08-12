import { describe, expect, test } from "vitest";

import type { ContentVaultMutation } from "../../content-vault/contracts";
import type { RemoteMessageContent } from "../../remote-collaboration/protocol";
import {
  orderMobileOutbox,
  orderMobileVaultOutbox,
  mobileMigrationStoresToClear,
  parseCachedRemoteEvents,
  type MobileOutboxEntry,
  type MobileVaultOutboxEntry,
} from "./storage";

describe("mobile durable outbox order", () => {
  test("replays reliable commands in creation order rather than UUID key order", () => {
    const later = commandEntry("000-later", "2026-08-04T00:01:00.000Z");
    const earlier = commandEntry("zzz-earlier", "2026-08-04T00:00:00.000Z");

    expect(orderMobileOutbox([later, earlier])).toEqual([earlier, later]);
  });

  test("replays Vault mutations in creation order with a deterministic tie break", () => {
    const later = vaultEntry("000-later", "2026-08-04T00:01:00.000Z");
    const sameTimeSecond = vaultEntry("bbb", "2026-08-04T00:00:00.000Z");
    const sameTimeFirst = vaultEntry("aaa", "2026-08-04T00:00:00.000Z");

    expect(orderMobileVaultOutbox([later, sameTimeSecond, sameTimeFirst]))
      .toEqual([sameTimeFirst, sameTimeSecond, later]);
  });
});

describe("mobile cached event compatibility", () => {
  test("clears legacy event projections and unsent envelopes during the V6 migration", () => {
    expect(mobileMigrationStoresToClear(5)).toEqual(["events", "outbox"]);
    expect(mobileMigrationStoresToClear(6)).toEqual(["events", "outbox"]);
    expect(mobileMigrationStoresToClear(0)).toEqual([]);
    expect(mobileMigrationStoresToClear(7)).toEqual(["events"]);
    expect(mobileMigrationStoresToClear(8)).toEqual(["events"]);
    expect(mobileMigrationStoresToClear(9)).toEqual([]);
  });

  test("drops removed snapshot events before rebuilding mobile state", () => {
    const current = {
      cacheKey: "conversation-index",
      kind: "conversation.index",
      eventId: "current-event",
      conversations: [],
    };
    const removed = {
      cacheKey: "spaces",
      kind: "space.snapshot",
      eventId: "legacy-event",
      spaces: [],
    };

    expect(parseCachedRemoteEvents([removed, current, null])).toEqual([{
      kind: "conversation.index",
      eventId: "current-event",
      conversations: [],
    }]);
  });
});

function commandEntry(clientMessageId: string, createdAt: string): MobileOutboxEntry {
  const content: RemoteMessageContent = {
    type: "command",
    command: {
      kind: "conversation.page.request",
      commandId: clientMessageId,
      conversationId: "conversation-1",
      limit: 50,
    },
  };
  return { clientMessageId, content, createdAt };
}

function vaultEntry(mutationId: string, createdAt: string): MobileVaultOutboxEntry {
  const mutation: ContentVaultMutation = {
    protocolVersion: "content-vault/v1",
    mutationId,
    kind: "managed_file",
    resourceId: mutationId,
    operation: "delete",
    baseRevision: 1,
  };
  return { mutationId, mutation, createdAt };
}
