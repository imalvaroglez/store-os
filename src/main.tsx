import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { ThemeProvider } from "./design-system/theme";
import { AuthProvider } from "./app/firebase/AuthProvider";
import { StoreProvider } from "./app/StoreProvider";
import "./index.css";
import { registerPwa } from "./pwa";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <StoreProvider>
            <App />
            <Analytics />
          </StoreProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);

registerPwa();
