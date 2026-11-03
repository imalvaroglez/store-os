import { describe, expect, it } from "vitest";
import { validateFirebaseConfig } from "./config";

const validConfig = {
  apiKey: "local-test-key",
  authDomain: "store-os-dev.firebaseapp.com",
  projectId: "store-os-dev",
  storageBucket: "store-os-dev.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:local-test-app",
};

describe("validateFirebaseConfig", () => {
  it("accepts the dev project for local development and Preview", () => {
    expect(validateFirebaseConfig(validConfig, undefined, false)).toBeNull();
    expect(validateFirebaseConfig(validConfig, "preview", false)).toBeNull();
  });

  it("accepts production only for the production environment", () => {
    expect(validateFirebaseConfig({ ...validConfig, projectId: "store-os-f7cf8" }, "production", false)).toBeNull();
    expect(validateFirebaseConfig({ ...validConfig, projectId: "store-os-f7cf8" }, "preview", false)).toContain("store-os-dev");
    expect(validateFirebaseConfig(validConfig, "production", false)).toContain("store-os-f7cf8");
  });

  it("rejects missing Firebase settings before the app mounts", () => {
    expect(validateFirebaseConfig({ ...validConfig, appId: "" }, undefined, false)).toContain("aplicación");
    expect(validateFirebaseConfig({ ...validConfig, projectId: "" }, undefined, false)).toContain("proyecto");
  });

  it("allows emulator mode only for local dev with the dev project", () => {
    expect(validateFirebaseConfig(validConfig, undefined, true)).toBeNull();
    expect(validateFirebaseConfig(validConfig, "preview", true)).toContain("emulador");
    expect(validateFirebaseConfig({ ...validConfig, projectId: "store-os-f7cf8" }, undefined, true)).toContain("store-os-dev");
  });

  it("rejects unknown deployment environments", () => {
    expect(validateFirebaseConfig(validConfig, "staging", false)).toContain("ambiente");
  });
});
