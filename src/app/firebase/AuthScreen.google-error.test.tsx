// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  signInWithGoogle: vi.fn(),
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
}));

vi.mock("./auth", async (importOriginal) => ({
  ...await importOriginal<object>(),
  signInWithGoogle: mocks.signInWithGoogle,
  signInWithEmail: mocks.signInWithEmail,
  signUpWithEmail: mocks.signUpWithEmail,
}));

import { AuthScreen } from "./AuthScreen";

// #481: a failed or cancelled Google attempt must land the person back on this
// screen with a specific Spanish message and a working retry — never stuck on
// the Firebase interstitial and never a swallowed generic message.
beforeEach(() => {
  mocks.signInWithGoogle.mockReset();
  mocks.signInWithEmail.mockReset();
});

function attemptGoogle() {
  fireEvent.click(screen.getByRole("button", { name: "Continuar con Google" }));
}

describe("Google popup failures on the sign-in screen", () => {
  it("explains a blocked popup in Spanish and stays retryable", async () => {
    mocks.signInWithGoogle.mockRejectedValue({ code: "auth/popup-blocked" });

    render(<AuthScreen />);

    attemptGoogle();
    await waitFor(() =>
      expect(screen.getByText(/bloqueó la ventana de Google/)).toBeTruthy()
    );

    // Retry works: a fresh attempt clears the stale message.
    mocks.signInWithGoogle.mockResolvedValue({ uid: "u", email: "f@e.com", role: "member" });
    attemptGoogle();
    await waitFor(() => expect(mocks.signInWithGoogle).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/bloqueó la ventana de Google/)).toBeNull());
  });

  it("shows the unauthorized-domain guidance instead of the generic message", async () => {
    mocks.signInWithGoogle.mockRejectedValue({ code: "auth/unauthorized-domain" });

    render(<AuthScreen />);

    attemptGoogle();
    // Regression: this message used to be thrown code-less from auth.ts and
    // swallowed by friendlyError's code check, so nobody ever saw it.
    await waitFor(() =>
      expect(screen.getByText(/dominio no está autorizado/)).toBeTruthy()
    );
  });

  it("explains a cancelled attempt without calling it a failure to complete", async () => {
    mocks.signInWithGoogle.mockRejectedValue({ code: "auth/popup-closed-by-user" });

    render(<AuthScreen />);

    attemptGoogle();
    await waitFor(() =>
      expect(screen.getByText("Se canceló el inicio con Google.")).toBeTruthy()
    );
  });

  it("falls back to a retryable Spanish message for unknown errors", async () => {
    mocks.signInWithGoogle.mockRejectedValue({ code: "auth/internal-error" });

    render(<AuthScreen />);

    attemptGoogle();
    await waitFor(() =>
      expect(screen.getByText("No se pudo completar. Intenta de nuevo.")).toBeTruthy()
    );
    expect(screen.getByRole("button", { name: "Continuar con Google" })).not.toBeDisabled();
  });

  it("explains a superseded popup attempt as a cancellation", async () => {
    mocks.signInWithGoogle.mockRejectedValue({ code: "auth/cancelled-popup-request" });

    render(<AuthScreen />);

    attemptGoogle();
    await waitFor(() =>
      expect(screen.getByText("Se canceló el inicio con Google.")).toBeTruthy()
    );
  });
});

describe("email/password failures share the same screen mapping", () => {
  async function attemptEmailSignIn() {
    fireEvent.change(screen.getByLabelText("Correo"), { target: { value: "fer@test.os" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "secreto123" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
  }

  it("treats an unknown email like a wrong password", async () => {
    mocks.signInWithEmail.mockRejectedValue({ code: "auth/user-not-found" });

    render(<AuthScreen />);

    await attemptEmailSignIn();
    await waitFor(() =>
      expect(screen.getByText("Correo o contraseña incorrectos.")).toBeTruthy()
    );
  });

  it("explains a connection failure with a flow-neutral message (no Google out of context)", async () => {
    mocks.signInWithEmail.mockRejectedValue({ code: "auth/network-request-failed" });

    render(<AuthScreen />);

    await attemptEmailSignIn();
    await waitFor(() =>
      expect(screen.getByText("No hubo conexión. Revisa tu conexión e inténtalo de nuevo.")).toBeTruthy()
    );
  });
});
