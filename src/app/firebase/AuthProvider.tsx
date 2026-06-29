import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  isFirebaseConfigured,
} from "./config";
import {
  subscribeToAuth,
  signInWithEmail as doSignIn,
  signUpWithEmail as doSignUp,
  signInWithGoogle as doGoogle,
  signOutFirebase as doSignOut,
  type AppUser,
} from "./auth";

// App-wide auth state. When `user` is null the app is in local-demo mode; when
// set, the cloud data layer is active. `authReady` is false during the initial
// Firebase session check.

type AuthContextValue = {
  user: AppUser | null;
  authReady: boolean;
  enabled: boolean; // false when Firebase isn't configured (pure local app)
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const enabled = isFirebaseConfigured();
  const [user, setUser] = useState<AppUser | null>(null);
  const [authReady, setAuthReady] = useState(!enabled);

  useEffect(() => {
    if (!enabled) return; // pure local mode: never signed in
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
    signIn: async (email, password) => {
      await doSignIn(email, password);
    },
    signUp: async (email, password) => {
      await doSignUp(email, password);
    },
    signInGoogle: async () => {
      await doGoogle();
    },
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
