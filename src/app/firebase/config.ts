import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  type Auth,
} from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  type Firestore,
} from "firebase/firestore";

// Firebase config. Values come from Vite env vars (prefixed VITE_). The public
// Firebase config is safe in a client bundle; access is enforced by Security
// Rules, not by hiding these keys. In dev/tests we point at the local emulator
// via VITE_FIREBASE_EMULATOR=true. Copy .env.example to .env and fill it in.

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

const projectId =
  firebaseConfig.projectId ||
  (import.meta.env.VITE_FIREBASE_EMULATOR ? "store-os-demo" : undefined);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let emulatorsConnected = false;

/** True when Firebase is configured enough to initialize (real OR emulator). */
export function isFirebaseConfigured(): boolean {
  return Boolean(
    projectId &&
      (import.meta.env.VITE_FIREBASE_EMULATOR || firebaseConfig.apiKey)
  );
}

export function getFirebase(): { app: FirebaseApp; auth: Auth; db: Firestore } {
  if (!isFirebaseConfigured()) {
    throw new Error(
      "Firebase not configured. Set VITE_FIREBASE_* env vars (see .env.example)."
    );
  }
  if (!app) {
    const initialized = initializeApp({ ...firebaseConfig, projectId: projectId! }, "store-os");
    app = initialized;
    auth = getAuth(initialized);
    db = getFirestore(initialized);
  }
  const a = auth!;
  const database = db!;
  if (import.meta.env.VITE_FIREBASE_EMULATOR && !emulatorsConnected) {
    const authHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
    const fsHost = import.meta.env.VITE_FIREBASE_FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
    connectAuthEmulator(a, `http://${authHost}`);
    connectFirestoreEmulator(database, fsHost.split(":")[0], Number(fsHost.split(":")[1]));
    emulatorsConnected = true;
  }
  return { app: app!, auth: a, db: database };
}
