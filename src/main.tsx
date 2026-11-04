import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { ThemeProvider } from "./design-system/theme";
import { AuthProvider } from "./app/firebase/AuthProvider";
import { StoreProvider } from "./app/StoreProvider";
import { getFirebaseConfigurationError } from "./app/firebase/config";
import { StartupErrorScreen } from "./app/StartupErrorScreen";
import { retireLegacyAdminState } from "./lib/storage";
import "./index.css";
import { registerPwa } from "./pwa";

// Retire only the former full admin snapshot before any React component can
// read browser storage. A blocked cleanup stops the app without opening data.
const legacyAdminStateRetired = retireLegacyAdminState();
const firebaseConfigurationError = getFirebaseConfigurationError();

function Bootstrap() {
  if (!legacyAdminStateRetired) {
    return (
      <StartupErrorScreen
        title="No se pudo limpiar el estado anterior"
        message="Store OS no abrió el panel ni leyó esos datos. Revisa el almacenamiento del navegador y vuelve a iniciar."
        onRetry={() => window.location.reload()}
      />
    );
  }
  if (firebaseConfigurationError) {
    return (
      <StartupErrorScreen
        title="No se pudo iniciar Store OS"
        message={firebaseConfigurationError}
        onRetry={() => window.location.reload()}
      />
    );
  }
  return (
    <AuthProvider>
      <StoreProvider>
        <App />
      </StoreProvider>
    </AuthProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <Bootstrap />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);

registerPwa();
