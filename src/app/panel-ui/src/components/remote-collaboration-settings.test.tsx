import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

test("open account creation omits invitations and keeps Relay configuration out of the UI", async () => {
  vi.stubEnv("VITE_AGENTARBOR_RELAY_URL", "https://relay.example.com");
  const fetch = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      remote: {
        state: "unregistered",
        peerOnline: false,
        suggestedDeviceName: "feng",
      },
    }))
    .mockResolvedValueOnce(jsonResponse({
      remote: {
        state: "offline",
        accountHandle: "user-example",
        peerOnline: false,
      },
    }, 201));
  vi.stubGlobal("fetch", fetch);
  const { RemoteCollaborationSettings } = await import("./remote-collaboration-settings");
  const user = userEvent.setup();

  render(<RemoteCollaborationSettings />);

  expect(await screen.findByText("创建协同账户后即可添加手机")).toBeTruthy();
  expect(screen.queryByLabelText("邀请码")).toBeNull();
  expect(screen.queryByText(/Relay 地址|中继地址/u)).toBeNull();
  expect((screen.getByLabelText("设备名称") as HTMLInputElement).value).toBe("feng");
  expect(screen.getByText("设备选项")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "创建协同账户" }));

  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  const [url, request] = fetch.mock.calls[1] as [string, RequestInit];
  expect(url).toBe("/api/remote-collaboration/account/activate");
  expect(JSON.parse(request.body as string)).toEqual({
    relayUrl: "https://relay.example.com",
    deviceName: "feng",
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
