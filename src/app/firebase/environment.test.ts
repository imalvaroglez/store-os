import { describe, expect, it } from "vitest";
import { shouldUseFirebaseEmulator } from "./environment";

describe("shouldUseFirebaseEmulator", () => {
  it("routes only local development to the emulator", () => {
    expect(shouldUseFirebaseEmulator("true", undefined)).toBe(true);
    expect(shouldUseFirebaseEmulator("false", undefined)).toBe(false);
    expect(shouldUseFirebaseEmulator("true", "preview")).toBe(false);
    expect(shouldUseFirebaseEmulator("true", "production")).toBe(false);
  });
});
