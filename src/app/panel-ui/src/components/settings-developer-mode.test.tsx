import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { AboutSettings } from "./settings-dialog";

test("about settings controls developer-only product information", () => {
  function ControlledAbout(): React.ReactElement {
    const [enabled, setEnabled] = useState(false);
    return (
      <AboutSettings
        config={{
          product: {
            name: "AgentArbor",
            version: "0.3.2",
            defaultEntry: "Desktop Shell / Panel",
            runtimeModeLabel: "Ordinary Agent",
            configDirectory: "C:/config",
            runtimeDirectory: "C:/runtime",
          },
        }}
        agentClusterEnabled={false}
        onAgentClusterEnabledChange={() => undefined}
        developerModeEnabled={enabled}
        onDeveloperModeChange={setEnabled}
        onCheckAppUpdate={() => undefined}
        onInstallAppUpdate={() => undefined}
      />
    );
  }

  render(<ControlledAbout />);

  const developerSwitch = screen.getByRole("switch", { name: "显示开发者信息" });
  expect(developerSwitch.getAttribute("aria-checked")).toBe("false");
  expect(screen.queryByLabelText("产品运行信息")).toBeNull();
  expect(screen.queryByLabelText("本机数据目录")).toBeNull();

  fireEvent.click(developerSwitch);

  expect(developerSwitch.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByLabelText("产品运行信息")).toBeTruthy();
  expect(screen.getByLabelText("本机数据目录")).toBeTruthy();
});
