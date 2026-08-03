import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.gustfeng.agentarbor",
  appName: "AgentArbor",
  webDir: "dist/app/mobile-ui",
  server: {
    androidScheme: "https",
  },
};

export default config;
