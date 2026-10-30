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
import {
  FIREBASE_DEV_PROJECT_ID,
  FIREBASE_PRODUCTION_PROJECT_ID,
} from "./projectIds";
import {
  FIREBASE_EMULATOR_ENABLED,
  FIREBASE_EMULATOR_REQUESTED,
} from "./environment";

export { FIREBASE_EMULATOR_ENABLED } from "./environment";

// Firebase config. Values come from Vite env vars (prefixed VITE_). The public
// Firebase config is safe in a client bundle; access is enforced by Security
// Rules, not by hiding these keys. In dev/tests we point at the local emulator
// via VITE_FIREBASE_EMULATOR=true. Copy .env.example to .env and fill it in.

export type FirebaseConfigValues = {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
};

const firebaseConfig: FirebaseConfigValues = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const vercelEnvironment = import.meta.env.VITE_VERCEL_ENV;

/** Return a safe, user-visible explanation when this build cannot use Firebase. */
export function validateFirebaseConfig(
  config: FirebaseConfigValues,
  environment: string | undefined,
  emulatorEnabled: boolean
): string | null {
  if (environment && !["development", "preview", "production"].includes(environment)) {
    return "La configuración de Firebase indica un ambiente desconocido.";
  }
  if (emulatorEnabled && environment) {
    return "El emulador de Firebase solo se puede usar en desarrollo local.";
  }

  const required: (keyof FirebaseConfigValues)[] = [
    "apiKey",
    "authDomain",
    "projectId",
    "storageBucket",
    "messagingSenderId",
    "appId",
  ];
  const missing = required.filter((key) => !config[key]?.trim());
  if (missing.length) {
    const labels: Record<keyof FirebaseConfigValues, string> = {
      apiKey: "clave de API",
      authDomain: "dominio de acceso",
      projectId: "identificador del proyecto",
      storageBucket: "depósito de archivos",
      messagingSenderId: "remitente de mensajes",
      appId: "aplicación web",
    };
    return `Falta configurar Firebase: ${missing.map((key) => labels[key]).join(", ")}.`;
  }

  const expectedProjectId = environment === "production"
    ? FIREBASE_PRODUCTION_PROJECT_ID
    : FIREBASE_DEV_PROJECT_ID;
  if (config.projectId !== expectedProjectId) {
    return `Este ambiente debe usar el proyecto Firebase ${expectedProjectId}.`;
  }
  return null;
}

export function getFirebaseConfigurationError(): string | null {
  return validateFirebaseConfig(firebaseConfig, vercelEnvironment, FIREBASE_EMULATOR_REQUESTED);
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let emulatorsConnected = false;

/** True when Firebase is configured enough to initialize (real OR emulator). */
export function isFirebaseConfigured(): boolean {
  return getFirebaseConfigurationError() === null;
}

export function getFirebase(): { app: FirebaseApp; auth: Auth; db: Firestore } {
  const configError = getFirebaseConfigurationError();
  if (configError) throw new Error(configError);
  if (!app) {
    const initialized = initializeApp(
      firebaseConfig as { apiKey: string; authDomain: string; projectId: string; storageBucket: string; messagingSenderId: string; appId: string },
      "store-os"
    );
    app = initialized;
    auth = getAuth(initialized);
    db = getFirestore(initialized);
  }
  const a = auth!;
  const database = db!;
  if (FIREBASE_EMULATOR_ENABLED && !emulatorsConnected) {
    const authHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
    const fsHost = import.meta.env.VITE_FIREBASE_FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
    connectAuthEmulator(a, `http://${authHost}`);
    connectFirestoreEmulator(database, fsHost.split(":")[0], Number(fsHost.split(":")[1]));
    emulatorsConnected = true;
  }
  return { app: app!, auth: a, db: database };
}
