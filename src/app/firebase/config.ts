import { initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import {
  getAuth,
  type Auth,
} from "firebase/auth";
import {
  getFirestore,
  type Firestore,
} from "firebase/firestore";

// Firebase config. Values come from Vite env vars (prefixed VITE_). The public
// Firebase config is safe in a client bundle; access is enforced by Security
// Rules, not by hiding these keys. Localhost and Preview always use store-os-dev;
// production uses store-os-f7cf8.

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

const DEV_PROJECT_ID = "store-os-dev";
const PROD_PROJECT_ID = "store-os-f7cf8";
const deployment = import.meta.env.VITE_VERCEL_ENV || "development";
const expectedProjectId = deployment === "production" ? PROD_PROJECT_ID : DEV_PROJECT_ID;
const requiredConfig = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.storageBucket,
  firebaseConfig.messagingSenderId,
  firebaseConfig.appId,
];
const configurationError =
  requiredConfig.some((value) => !value) || firebaseConfig.projectId !== expectedProjectId
    ? `Firebase está mal configurado para este ambiente. Se esperaba el proyecto ${expectedProjectId}; ` +
      `revisa las variables VITE_FIREBASE_* en .env.local.`
    : null;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

/** True when the complete real Firebase configuration is present. */
export function isFirebaseConfigured(): boolean {
  return configurationError === null;
}

/** Throws a visible configuration error instead of silently switching storage. */
export function assertFirebaseConfiguration(): void {
  if (import.meta.env.MODE === "test") return;
  if (configurationError) throw new Error(configurationError);
}

export function getFirebase(): { app: FirebaseApp; auth: Auth; db: Firestore } {
  assertFirebaseConfiguration();
  if (!app) {
    const initialized = initializeApp(
      firebaseConfig as FirebaseOptions,
      "store-os"
    );
    app = initialized;
    auth = getAuth(initialized);
    db = getFirestore(initialized);
  }
  const a = auth!;
  const database = db!;
  return { app: app!, auth: a, db: database };
}
