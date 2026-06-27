import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
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
} from "firebase/firestore";
import { getFirebase } from "./config";

export type Role = "super_admin" | "member";

export type AppUser = {
  uid: string;
  email: string | null;
  displayName?: string | null;
  role: Role;
};

const GOOGLE = new GoogleAuthProvider();

/** Ensure a users/{uid} doc exists. The FIRST user ever becomes super_admin. */
async function ensureUserDoc(fbUser: FbUser): Promise<AppUser> {
  const { db } = getFirebase();
  const ref = doc(db, "users", fbUser.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return { uid: fbUser.uid, email: fbUser.email, displayName: fbUser.displayName, ...(snap.data() as { role: Role }) };
  }
  // Bootstrap: first user in the collection becomes super_admin, rest are members.
  const all = await getDocs(collection(db, "users"));
  const role: Role = all.empty ? "super_admin" : "member";
  await setDoc(ref, {
    email: fbUser.email ?? "",
    displayName: fbUser.displayName ?? "",
    role,
    createdAt: serverTimestamp(),
  });
  return { uid: fbUser.uid, email: fbUser.email, displayName: fbUser.displayName, role };
}

export async function signUpWithEmail(email: string, password: string): Promise<AppUser> {
  const { auth } = getFirebase();
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return ensureUserDoc(cred.user);
}

export async function signInWithEmail(email: string, password: string): Promise<AppUser> {
  const { auth } = getFirebase();
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return ensureUserDoc(cred.user);
}

export async function signInWithGoogle(): Promise<AppUser> {
  const { auth } = getFirebase();
  const cred = await signInWithPopup(auth, GOOGLE);
  return ensureUserDoc(cred.user);
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
      const appUser = await ensureUserDoc(fbUser);
      onChange(appUser);
    } catch {
      onChange(null);
    }
  });
}

/** Look up a uid by email (for inviting members). Returns uid or null. */
export async function findUidByEmail(email: string): Promise<string | null> {
  const { db } = getFirebase();
  const q = query(collection(db, "users"), where("email", "==", email.toLowerCase().trim()));
  const snap = await getDocs(q);
  return snap.empty ? null : snap.docs[0].id;
}
