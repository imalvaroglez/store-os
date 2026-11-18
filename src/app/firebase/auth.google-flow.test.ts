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

import { signInWithGoogle } from "./auth";

// #481: the Google flow must stay on signInWithPopup for EVERY device. The
// redirect flow silently fails on Safari 16.1+ for apps served outside the
// firebaseapp.com authDomain (Store OS runs on Vercel/localhost), so the iOS
// Safari fix is the firebase >= 12.19.0 SDK upgrade — never a redirect split.
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

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

describe("signInWithGoogle", () => {
  it("keeps the popup flow on iPhone Safari (redirect is broken for this hosting)", async () => {
    vi.stubGlobal("navigator", { userAgent: IPHONE_SAFARI, maxTouchPoints: 5 });
    mocks.signInWithPopup.mockResolvedValue({ user: VERIFIED_USER });

    const result = await signInWithGoogle();

    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithPopup.mock.calls[0][0]).toBe(mocks.auth);
    expect(mocks.signInWithRedirect).not.toHaveBeenCalled();
    expect(result).toMatchObject({ uid: "uid_google", email: "fer@example.com", role: "member" });
  });

  it("keeps the popup flow on desktop and returns the signed-in user", async () => {
    vi.stubGlobal("navigator", { userAgent: WINDOWS_CHROME, maxTouchPoints: 0 });
    mocks.signInWithPopup.mockResolvedValue({ user: VERIFIED_USER });

    const result = await signInWithGoogle();

    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ uid: "uid_google", role: "member" });
  });

  it("propagates the raw AuthError so the screen can explain it in Spanish", async () => {
    vi.stubGlobal("navigator", { userAgent: WINDOWS_CHROME, maxTouchPoints: 0 });
    mocks.signInWithPopup.mockRejectedValue({ code: "auth/unauthorized-domain" });

    // The code must survive to the UI layer: friendlyError maps it there.
    await expect(signInWithGoogle()).rejects.toMatchObject({ code: "auth/unauthorized-domain" });
  });
});
