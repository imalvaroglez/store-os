import { initializeApp } from "firebase-admin/app";
if (!globalThis.__storeOsAdmin) globalThis.__storeOsAdmin = initializeApp();
export const adminApp = globalThis.__storeOsAdmin;
