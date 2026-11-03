import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  isFirebaseConfigured,
  getFirebaseConfigurationError,
} from "./config";
import {
  subscribeToAuth,
  signOutFirebase as doSignOut,
  type AppUser,
} from "./auth";

// App-wide auth state. Private routes require `user`; without a configured
// Firebase session, the app stays on the authentication screen. `authReady` is
// false during the initial Firebase session check.

type AuthContextValue = {
  user: AppUser | null;
  authReady: boolean;
  enabled: boolean;
  error: string | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const enabled = isFirebaseConfigured();
  const [user, setUser] = useState<AppUser | null>(null);
  const [authReady, setAuthReady] = useState(!enabled);
  const [error, setError] = useState<string | null>(getFirebaseConfigurationError());

  useEffect(() => {
    if (!enabled) return; // No Firebase session is available.
    let active = true;
    try {
      const unsub = subscribeToAuth(
        (u) => {
          if (!active) return;
          setUser(u);
          setError(null);
          setAuthReady(true);
        },
        () => {
          if (!active) return;
          setUser(null);
          setError("No se pudo verificar tu sesión. Revisa tu conexión e intenta de nuevo.");
          setAuthReady(true);
        }
      );
      return () => {
        active = false;
        unsub();
      };
    } catch {
      setError("No se pudo iniciar el acceso a Firebase. Revisa la configuración e intenta de nuevo.");
      setAuthReady(true);
      return () => { active = false; };
    }
  }, [enabled]);

  const value: AuthContextValue = {
    user,
    authReady,
    enabled,
    error,
    signOut: async () => {
      await doSignOut();
      setUser(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
