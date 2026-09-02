import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  sendEmailVerification,
  sendSignInLinkToEmail,
  type AuthError,
  type User as FbUser,
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  writeBatch,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { getFirebase } from "./config";

export type Role = "super_admin" | "member";

export type AppUser = {
  uid: string;
  email: string | null;
  displayName?: string | null;
  role: Role;
};

/** Minimal account shape returned by exact-email search (no directory listing). */
export type EmailAccount = { uid: string; email: string; displayName: string };

const GOOGLE = new GoogleAuthProvider();
const PLATFORM_ADMIN_EMAIL = "admin@store.os";

const GMAIL_DOMAINS = ["gmail.com", "googlemail.com"];

/**
 * Canonical email: lowercase + strip dots from the local part on Gmail
 * (a.b@gmail.com ≡ ab@gmail.com; googlemail ≡ gmail). Must stay IDENTICAL to
 * canonicalEmail() in firestore.rules — a rules test covers the drift.
 */
export function normalizeEmail(email: string): string {
  const clean = email.toLowerCase().trim();
  const at = clean.lastIndexOf("@");
  if (at <= 0) return clean;
  const local = clean.slice(0, at);
  const domain = clean.slice(at + 1);
  if (GMAIL_DOMAINS.includes(domain)) return `${local.replace(/\./g, "")}@gmail.com`;
  return clean;
}

/**
 * Ensure a users/{uid} doc exists — the SINGLE verified-email guard. If the
 * Firebase account's email is not verified, nothing is created or updated and
 * no membership reconciliation runs: an unverified token proves nothing. Every
 * entry point (password, Google, email-link, AuthProvider remount) funnels
 * here instead of duplicating the check.
 */
async function ensureUserDoc(fbUser: FbUser): Promise<AppUser> {
  // CENTRAL GUARD: unverified email → no profile, no panel, no reconciliation.
  if (!fbUser.email || !fbUser.emailVerified) {
    return { uid: fbUser.uid, email: fbUser.email, displayName: fbUser.displayName, role: "member" };
  }
  const { db } = getFirebase();
  const ref = doc(db, "users", fbUser.uid);
  const snap = await getDoc(ref);
  const identity = {
    email: fbUser.email,
    emailNormalized: normalizeEmail(fbUser.email),
    emailVerified: true, // from the token, never from a request body
  };
  if (snap.exists()) {
    const data = snap.data() as { role: Role; emailNormalized?: string; emailVerified?: boolean };
    // Recover the designated platform account if it was created after the
    // first signup. The Firestore rule requires the same verified allowlist.
    const isPlatformAdmin = normalizeEmail(fbUser.email) === PLATFORM_ADMIN_EMAIL;
    let role = data.role ?? "member";
    if (isPlatformAdmin && data.role !== "super_admin") {
      try {
        await setDoc(ref, { ...identity, role: "super_admin" }, { merge: true });
        role = "super_admin";
      } catch {
        // Do not lock the account out while a deployed ruleset catches up.
        // The verified allowlisted email still identifies the platform admin;
        // the next login retries the profile repair.
        role = "super_admin";
      }
    }
    // Legacy backfill (pre-invitations profiles lack the normalized fields).
    if (!data.emailNormalized || data.emailVerified !== true) {
      await setDoc(ref, identity, { merge: true }).catch(() => {});
    }
    return {
      uid: fbUser.uid,
      email: fbUser.email,
      displayName: fbUser.displayName,
      role: isPlatformAdmin ? "super_admin" : role,
    };
  }
  // The designated platform account is always super_admin; otherwise the first
  // user bootstraps the platform and later signups are members.
  const all = await getDocs(collection(db, "users"));
  const role: Role = normalizeEmail(fbUser.email) === PLATFORM_ADMIN_EMAIL || all.empty ? "super_admin" : "member";
  await setDoc(ref, {
    ...identity,
    displayName: fbUser.displayName ?? "",
    role,
    createdAt: serverTimestamp(),
  });
  return { uid: fbUser.uid, email: fbUser.email, displayName: fbUser.displayName, role };
}

/**
 * Move pendingInvites → memberUids for the given verified user. Runs after
 * every successful ensureUserDoc. Idempotent; a failed batch retries once and
 * then gives up silently — the next login reconciles again.
 */
export async function reconcilePendingInvites(fbUser: FbUser): Promise<void> {
  if (!fbUser.email || !fbUser.emailVerified) return;
  const { db } = getFirebase();
  const canonical = normalizeEmail(fbUser.email);
  const attempt = async () => {
    const q = query(collection(db, "stores"), where("pendingInvites", "array-contains", canonical));
    const snap = await getDocs(q);
    for (const storeDoc of snap.docs) {
      const store = storeDoc.data() as { memberUids?: string[]; pendingInvites?: string[] };
      if ((store.memberUids ?? []).includes(fbUser.uid)) continue;
      // Dual-plane invariant (same two docs saveEntity batches for "stores").
      const batch = writeBatch(db);
      batch.update(doc(db, "stores", storeDoc.id), {
        memberUids: arrayUnion(fbUser.uid),
        pendingInvites: arrayRemove(canonical),
      });
      batch.update(doc(db, "adminStores", storeDoc.id), {
        memberUids: arrayUnion(fbUser.uid),
        pendingInvites: arrayRemove(canonical),
      });
      await batch.commit();
    }
  };
  try {
    await attempt();
  } catch {
    try {
      await attempt();
    } catch {
      // Silent by design: idempotent, next login retries.
    }
  }
}

/** ensureUserDoc + reconcile, the post-login sequence every entry point shares. */
async function afterLogin(fbUser: FbUser): Promise<AppUser> {
  try {
    const appUser = await ensureUserDoc(fbUser);
    if (fbUser.email && fbUser.emailVerified) await reconcilePendingInvites(fbUser).catch(() => {});
    return appUser;
  } catch {
    // Firebase Auth already accepted the credentials. Keep the session alive
    // when Firestore is offline or its rules are still catching up.
    return {
      uid: fbUser.uid,
      email: fbUser.email,
      displayName: fbUser.displayName,
      role: fbUser.emailVerified && normalizeEmail(fbUser.email ?? "") === PLATFORM_ADMIN_EMAIL
        ? "super_admin"
        : "member",
    };
  }
}

export async function signUpWithEmail(email: string, password: string): Promise<AppUser> {
  const { auth } = getFirebase();
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  // Password accounts start unverified (the ensureUserDoc guard holds the
  // profile back until they verify); send the verification email now.
  await sendEmailVerification(cred.user).catch(() => {});
  return ensureUserDoc(cred.user);
}

export async function signInWithEmail(email: string, password: string): Promise<AppUser> {
  const { auth } = getFirebase();
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return afterLogin(cred.user);
}

export async function signInWithGoogle(): Promise<AppUser> {
  const { auth } = getFirebase();
  try {
    const cred = await signInWithPopup(auth, GOOGLE);
    return afterLogin(cred.user);
  } catch (error) {
    const code = (error as AuthError)?.code;
    if (code === "auth/unauthorized-domain") {
      throw new Error(
        "Este dominio no está autorizado para entrar con Google. Pide a la administración que lo agregue en Firebase Console → Authentication → Settings → Authorized domains."
      );
    }
    throw error;
  }
}

export async function signOutFirebase(): Promise<void> {
  const { auth } = getFirebase();
  await signOut(auth);
}

/** Subscribe to auth state; resolves an AppUser (or null) once the users doc is loaded. */
export function subscribeToAuth(onChange: (user: AppUser | null) => void): () => void {
  const { auth } = getFirebase();
  return onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) {
      onChange(null);
      return;
    }
    try {
      const appUser = await afterLogin(fbUser);
      onChange(appUser);
    } catch {
      onChange(null);
    }
  });
}

/**
 * Exact-email account search for inviting members (no directory enumeration):
 * returns ONE verified account or null. Tries the literal email first, then
 * the normalized one (stored as emailNormalized by ensureUserDoc).
 */
export async function findAccountByEmail(email: string): Promise<EmailAccount | null> {
  const { db } = getFirebase();
  const literal = email.toLowerCase().trim();
  const byEmail = await getDocs(
    query(collection(db, "users"), where("email", "==", literal), where("emailVerified", "==", true))
  );
  if (!byEmail.empty) {
    const d = byEmail.docs[0].data() as { email?: string; displayName?: string };
    return { uid: byEmail.docs[0].id, email: d.email ?? literal, displayName: d.displayName ?? "" };
  }
  const byNormalized = await getDocs(
    query(
      collection(db, "users"),
      where("emailNormalized", "==", normalizeEmail(email)),
      where("emailVerified", "==", true)
    )
  );
  if (byNormalized.empty) return null;
  const d = byNormalized.docs[0].data() as { email?: string; displayName?: string };
  return { uid: byNormalized.docs[0].id, email: d.email ?? literal, displayName: d.displayName ?? "" };
}

/** Look up a uid by email (for inviting members). Returns uid or null. */
export async function findUidByEmail(email: string): Promise<string | null> {
  const account = await findAccountByEmail(email).catch(() => null);
  return account?.uid ?? null;
}

/** Email-link auth (for inviting members who don't have an account yet). */
const INVITE_ACTION_CODE_SETTINGS = {
  url: typeof window !== "undefined" ? `${window.location.origin}/entrar` : "https://example.com/entrar",
  handleCodeInApp: true,
};

/** Send a sign-in link so an invited email can create their account. */
export async function sendInviteLink(email: string, store?: { name?: string }): Promise<void> {
  const { auth } = getFirebase();
  await sendSignInLinkToEmail(
    auth,
    email.toLowerCase().trim(),
    INVITE_ACTION_CODE_SETTINGS
  );
  void store; // store name could be templated into the email in a real backend.
}
