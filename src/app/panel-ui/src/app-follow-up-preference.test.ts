import { beforeEach, expect, test } from "vitest";
import { getConversationFollowUpMode, saveConversationFollowUpMode } from "./app-follow-up-preference";

beforeEach(() => window.localStorage.clear());

test("defaults to queue and persists an explicit mode", () => {
  expect(getConversationFollowUpMode()).toBe("queue");
  saveConversationFollowUpMode("guide");
  expect(getConversationFollowUpMode()).toBe("guide");
  saveConversationFollowUpMode("queue");
  expect(getConversationFollowUpMode()).toBe("queue");
});