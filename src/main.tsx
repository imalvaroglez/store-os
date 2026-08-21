import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { ThemeProvider } from "./design-system/theme";
import { AuthProvider } from "./app/firebase/AuthProvider";
import { StoreProvider } from "./app/StoreProvider";
import "./index.css";
import { registerPwa } from "./pwa";

// Dev/emulator only: the Firebase SDK injects a fixed-position warning banner
// that overlays and intercepts pointer events on the auth buttons (same trap
// the e2e suite works around). Hide it entirely — the emulator badge is noise
// for local testing, not information.
if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATOR === "true") {
  const style = document.createElement("style");
  style.textContent = ".firebase-emulator-warning{display:none!important;pointer-events:none!important;}";
  document.head.appendChild(style);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <StoreProvider>
            <App />
          </StoreProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);

registerPwa();
