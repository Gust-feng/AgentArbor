import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { Capacitor } from "@capacitor/core";

const DEVICE_TOKEN_KEY = "remote-device-token";
const WEB_FALLBACK_KEY = "agentarbor.remote.device-token";

export interface MobileCredentialStore {
  readDeviceToken(): Promise<string | undefined>;
  writeDeviceToken(token: string): Promise<void>;
  deleteDeviceToken(): Promise<void>;
}

export function createMobileCredentialStore(): MobileCredentialStore {
  if (Capacitor.isNativePlatform()) {
    return {
      async readDeviceToken() {
        const value = await SecureStorage.getItem(DEVICE_TOKEN_KEY);
        return value ?? undefined;
      },
      async writeDeviceToken(token) {
        await SecureStorage.setItem(DEVICE_TOKEN_KEY, token);
      },
      async deleteDeviceToken() {
        await SecureStorage.removeItem(DEVICE_TOKEN_KEY);
      },
    };
  }
  return {
    async readDeviceToken() { return localStorage.getItem(WEB_FALLBACK_KEY) ?? undefined; },
    async writeDeviceToken(token) { localStorage.setItem(WEB_FALLBACK_KEY, token); },
    async deleteDeviceToken() { localStorage.removeItem(WEB_FALLBACK_KEY); },
  };
}
