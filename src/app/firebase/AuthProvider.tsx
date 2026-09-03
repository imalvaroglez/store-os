import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  assertFirebaseConfiguration,
  isFirebaseConfigured,
} from "./config";
import {
  subscribeToAuth,
  signOutFirebase as doSignOut,
  type AppUser,
} from "./auth";

// App-wide auth state. `authReady` is false during the initial Firebase
// session check. Runtime data always comes from the configured Firebase project.

type AuthContextValue = {
  user: AppUser | null;
  authReady: boolean;
  enabled: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  assertFirebaseConfiguration();
  const enabled = import.meta.env.MODE !== "test" && isFirebaseConfigured();
  const [user, setUser] = useState<AppUser | null>(null);
  const [authReady, setAuthReady] = useState(!enabled);

  useEffect(() => {
    if (!enabled) return;
    const unsub = subscribeToAuth((u) => {
      setUser(u);
      setAuthReady(true);
    });
    return unsub;
  }, [enabled]);

  const value: AuthContextValue = {
    user,
    authReady,
    enabled,
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
