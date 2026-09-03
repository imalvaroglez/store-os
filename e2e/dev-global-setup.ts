import { createRequire } from "node:module";
import type { FullConfig } from "@playwright/test";
import { cert, getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { loadEnv, DEV_PROJECT_ID } = require("../scripts/check-env.cjs") as {
  loadEnv: (mode: string) => Record<string, string | undefined>;
  DEV_PROJECT_ID: string;
};

const ids = {
  store: "store_e2e_dev",
  product: "prod_e2e_dev_1",
  catalog: "e2e-dev",
  productSlug: "producto-prueba",
};

export default async function globalSetup(_config: FullConfig) {
  const env = loadEnv("development");
  if (env.VITE_FIREBASE_PROJECT_ID !== DEV_PROJECT_ID) {
    throw new Error(`Las pruebas E2E deben usar ${DEV_PROJECT_ID}.`);
  }
  let credential;
  if (env.FIREBASE_DEV_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(env.FIREBASE_DEV_SERVICE_ACCOUNT_JSON);
    if (serviceAccount.project_id && serviceAccount.project_id !== DEV_PROJECT_ID) {
      throw new Error(`La cuenta de servicio apunta a ${serviceAccount.project_id}, no a ${DEV_PROJECT_ID}.`);
    }
    credential = cert(serviceAccount);
  } else {
    credential = applicationDefault();
  }
  const app = getApps()[0] ?? initializeApp({ projectId: DEV_PROJECT_ID, credential });
  const db = getFirestore(app);
  const now = new Date().toISOString();
  const store = {
    id: ids.store,
    slug: ids.catalog,
    name: "Tienda de pruebas de integración",
    type: "inventory_tiered",
    priceTiers: [{ id: "t_retail", label: "Regular", order: 0 }],
    defaultTierId: "t_retail",
    createdAt: now,
    updatedAt: now,
  };
  const product = {
    id: ids.product,
    storeId: ids.store,
    slug: ids.productSlug,
    name: "Producto de pruebas",
    status: "published",
    price: 100,
    prices: { t_retail: 100 },
    quantityOnHand: 3,
    createdAt: now,
    updatedAt: now,
  };
  await Promise.all([
    db.doc(`stores/${ids.store}`).set(store),
    db.doc(`publicStores/${ids.catalog}`).set({ ...store, storeId: ids.store }),
    db.doc(`products/${ids.product}`).set(product),
    db.doc(`publicCatalogs/${ids.catalog}`).set({
      slug: ids.catalog,
      storeId: ids.store,
      storeSlug: ids.catalog,
      categories: [],
      products: [{
        productId: ids.product,
        productSlug: ids.productSlug,
        name: product.name,
        storeSlug: ids.catalog,
        storeId: ids.store,
        price: product.price,
        prices: product.prices,
        availability: "available",
        availableQuantity: product.quantityOnHand,
        imageUrl: null,
        categoryIds: [],
        isFeatured: false,
        isNew: false,
        canInquire: false,
        sortOrder: 0,
      }],
    }),
  ]);

  return async () => {
    const orderSnapshot = await db.collection("orders").where("storeId", "==", ids.store).get();
    const limitSnapshot = await db.collection("publicOrderLimits").where("storeId", "==", ids.store).get();
    const batch = db.batch();
    for (const snapshot of [...orderSnapshot.docs, ...limitSnapshot.docs]) batch.delete(snapshot.ref);
    for (const path of [
      `stores/${ids.store}`,
      `publicStores/${ids.catalog}`,
      `products/${ids.product}`,
      `publicCatalogs/${ids.catalog}`,
    ]) batch.delete(db.doc(path));
    await batch.commit();
  };
}

export { ids };
