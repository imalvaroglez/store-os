import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  isFirebaseConfigured,
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
  enabled: boolean; // false when Firebase is not configured
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const enabled = isFirebaseConfigured();
  const [user, setUser] = useState<AppUser | null>(null);
  const [authReady, setAuthReady] = useState(!enabled);

  useEffect(() => {
    if (!enabled) return; // No Firebase session is available.
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
