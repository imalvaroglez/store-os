import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { name: "auth-test" },
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
}));

vi.mock("firebase/auth", async (importOriginal) => ({
  ...await importOriginal<object>(),
  signInWithPopup: mocks.signInWithPopup,
  signInWithRedirect: mocks.signInWithRedirect,
  getRedirectResult: mocks.getRedirectResult,
}));

vi.mock("firebase/firestore", async (importOriginal) => ({
  ...await importOriginal<object>(),
  getDoc: mocks.getDoc,
  setDoc: mocks.setDoc,
}));

vi.mock("./config", () => ({
  getFirebase: () => ({ auth: mocks.auth, db: { name: "db-test" } }),
}));

import { googleUsesRedirect, signInWithGoogle, consumeGoogleRedirectResult } from "./auth";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_CLASSIC =
  "Mozilla/5.0 (iPad; CPU OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";
// iPadOS 13+ masquerades as desktop Safari; the giveaway is the touch screen.
const IPADOS_DESKTOP_LIKE =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

const VERIFIED_USER = {
  uid: "uid_google",
  email: "fer@example.com",
  emailVerified: true,
  displayName: "Fer",
};

beforeEach(() => {
  mocks.signInWithPopup.mockReset();
  mocks.signInWithRedirect.mockReset();
  mocks.getRedirectResult.mockReset();
  mocks.getDoc.mockReset();
  mocks.setDoc.mockReset();
  mocks.getDoc.mockResolvedValue({ exists: () => false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("googleUsesRedirect", () => {
  it("uses the redirect flow on iPhone Safari", () => {
    expect(googleUsesRedirect(IPHONE_SAFARI, 5)).toBe(true);
  });

  it("uses the redirect flow on classic iPad Safari", () => {
    expect(googleUsesRedirect(IPAD_CLASSIC, 5)).toBe(true);
  });

  it("detects iPadOS desktop-like Safari through the touch screen", () => {
    expect(googleUsesRedirect(IPADOS_DESKTOP_LIKE, 5)).toBe(true);
  });

  it("keeps the popup flow on desktop Safari (no touch)", () => {
    expect(googleUsesRedirect(MAC_SAFARI, 0)).toBe(false);
  });

  it("keeps the popup flow on desktop Chrome", () => {
    expect(googleUsesRedirect(WINDOWS_CHROME, 0)).toBe(false);
  });

  it("keeps the popup flow on Android", () => {
    expect(googleUsesRedirect(ANDROID_CHROME, 5)).toBe(false);
  });
});

describe("signInWithGoogle", () => {
  it("redirects instead of opening a popup on iPhone Safari", async () => {
    vi.stubGlobal("navigator", { userAgent: IPHONE_SAFARI, maxTouchPoints: 5 });

    const result = await signInWithGoogle();

    expect(mocks.signInWithRedirect).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithRedirect.mock.calls[0][0]).toBe(mocks.auth);
    expect(mocks.signInWithPopup).not.toHaveBeenCalled();
    // The redirect navigates away; the session lands later via
    // consumeGoogleRedirectResult + onAuthStateChanged, so no user yet.
    expect(result).toBeNull();
  });

  it("keeps the popup flow on desktop and returns the signed-in user", async () => {
    vi.stubGlobal("navigator", { userAgent: WINDOWS_CHROME, maxTouchPoints: 0 });
    mocks.signInWithPopup.mockResolvedValue({ user: VERIFIED_USER });

    const result = await signInWithGoogle();

    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithRedirect).not.toHaveBeenCalled();
    expect(result).toMatchObject({ uid: "uid_google", email: "fer@example.com", role: "member" });
  });

  it("explains an unauthorized domain in Spanish", async () => {
    vi.stubGlobal("navigator", { userAgent: WINDOWS_CHROME, maxTouchPoints: 0 });
    mocks.signInWithPopup.mockRejectedValue({ code: "auth/unauthorized-domain" });

    await expect(signInWithGoogle()).rejects.toThrow(/dominio no está autorizado/);
  });
});

describe("consumeGoogleRedirectResult", () => {
  it("returns null when no redirect is pending", async () => {
    mocks.getRedirectResult.mockResolvedValue(null);

    await expect(consumeGoogleRedirectResult()).resolves.toBeNull();
  });

  it("returns the signed-in user after a successful redirect", async () => {
    mocks.getRedirectResult.mockResolvedValue({ user: VERIFIED_USER });

    const result = await consumeGoogleRedirectResult();

    expect(result).toMatchObject({ uid: "uid_google", role: "member" });
  });

  it("explains an unauthorized domain in Spanish", async () => {
    mocks.getRedirectResult.mockRejectedValue({ code: "auth/unauthorized-domain" });

    await expect(consumeGoogleRedirectResult()).rejects.toThrow(/dominio no está autorizado/);
  });

  it("explains a connection failure in Spanish", async () => {
    mocks.getRedirectResult.mockRejectedValue({ code: "auth/network-request-failed" });

    await expect(consumeGoogleRedirectResult()).rejects.toThrow(/No hubo conexión/);
  });

  it("explains a cancellation in Spanish instead of a generic failure", async () => {
    mocks.getRedirectResult.mockRejectedValue({ code: "auth/user-cancelled" });

    await expect(consumeGoogleRedirectResult()).rejects.toThrow(/Se canceló el inicio con Google/);
  });

  it("fails with a retryable Spanish message for anything else", async () => {
    mocks.getRedirectResult.mockRejectedValue({ code: "auth/internal-error" });

    await expect(consumeGoogleRedirectResult()).rejects.toThrow(/No se pudo completar el acceso con Google/);
  });
});
