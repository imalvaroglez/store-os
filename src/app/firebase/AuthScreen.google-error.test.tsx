// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  consumeGoogleRedirectResult: vi.fn(),
  signInWithGoogle: vi.fn(),
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
}));

vi.mock("./auth", async (importOriginal) => ({
  ...await importOriginal<object>(),
  consumeGoogleRedirectResult: mocks.consumeGoogleRedirectResult,
  signInWithGoogle: mocks.signInWithGoogle,
  signInWithEmail: mocks.signInWithEmail,
  signUpWithEmail: mocks.signUpWithEmail,
  subscribeToAuth: (onChange: (u: null) => void) => {
    onChange(null);
    return () => {};
  },
  signOutFirebase: vi.fn(async () => {}),
}));

vi.mock("./config", () => ({
  isFirebaseConfigured: () => true,
  getFirebaseConfigurationError: () => null,
}));

import { AuthProvider } from "./AuthProvider";
import { AuthScreen } from "./AuthScreen";
import type { ReactNode } from "react";

function mountAuthTree(children: ReactNode) {
  return render(<AuthProvider>{children}</AuthProvider>);
}

beforeEach(() => {
  mocks.consumeGoogleRedirectResult.mockReset();
  mocks.signInWithGoogle.mockReset();
  mocks.consumeGoogleRedirectResult.mockResolvedValue(null);
});

describe("Google redirect failure surfaces on the sign-in screen", () => {
  it("shows the Spanish redirect error when the return trip failed, and a retry clears it", async () => {
    mocks.consumeGoogleRedirectResult.mockRejectedValue(
      new Error("Se canceló el inicio con Google.")
    );
    mocks.signInWithGoogle.mockResolvedValue(null);

    mountAuthTree(<AuthScreen />);

    await waitFor(() => expect(screen.getByText("Se canceló el inicio con Google.")).toBeTruthy());

    // Retry starts a fresh attempt and clears the stale message.
    fireEvent.click(screen.getByRole("button", { name: "Continuar con Google" }));
    await waitFor(() => expect(mocks.signInWithGoogle).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Se canceló el inicio con Google.")).toBeNull();
  });

  it("shows no redirect error when the flow completed or never started", async () => {
    mountAuthTree(<AuthScreen />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Entrar" })).toBeTruthy());
    expect(screen.queryByText(/inicio con Google/)).toBeNull();
  });
});
