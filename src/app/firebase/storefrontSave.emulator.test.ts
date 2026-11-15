import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { Category, Product, Store, Storefront } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any, uid: undefined as string | undefined }));
vi.mock("./config", () => ({
  getFirebase: () => ({ db: holder.db, auth: { currentUser: holder.uid ? { uid: holder.uid } : null } }),
}));
import { projectPublicForStore, saveStorefrontBatch } from "./firestoreData";

let env: RulesTestEnvironment;

// Runs in CI's rules job (emulator); skipped locally without FIRESTORE_EMULATOR_HOST.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("storefront save + public projection (#332)", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
  });
  afterAll(async () => {
    await env.cleanup();
  });

  it("borrar shipping/hours borra el campo en stores y publicStores — sin resurrección al recargar", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      holder.db = db;
      holder.uid = "sf-admin";
      await setDoc(doc(db, "stores/sf2-store"), { storefront: { shipping: "Viejo", hours: "Viejo", notice: "Queda" } });
      await setDoc(doc(db, "publicStores/olivia-emul"), { storeId: "sf2-store", storefront: { shipping: "Viejo", hours: "Viejo", notice: "Queda" } });

      await saveStorefrontBatch(
        { id: "sf2-store", slug: "olivia-emul" },
        { shipping: "", hours: "", notice: "Queda" } as Storefront,
        "2026-11-11T00:00:00Z"
      );

      const priv = (await getDoc(doc(db, "stores/sf2-store"))).data()!.storefront;
      expect(priv.shipping).toBeUndefined(); // borrado de verdad, no "" ni "Viejo"
      expect(priv.hours).toBeUndefined();
      expect(priv.notice).toBe("Queda"); // los demás campos sobreviven

      const pub = (await getDoc(doc(db, "publicStores/olivia-emul"))).data()!.storefront;
      expect(pub.shipping).toBeUndefined();
      expect(pub.hours).toBeUndefined();
      expect(pub.notice).toBe("Queda");
    });
  });

  it("la república tolera un storefront local con undefined (la proyección no se rompe)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      holder.db = db;
      holder.uid = "sf-admin";
      const store = {
        id: "sf3-store",
        slug: "olivia-emul2",
        name: "Olivia",
        type: "inventory_tiered",
        // Local state can carry nested undefineds (cleared inline fields);
        // setDoc would reject them ("Unsupported field value: undefined"). A
        // cleared slot ("") must land ABSENT here, same shape as the editor
        // batch — not as an empty string.
        storefront: { notice: undefined, shipping: "Envíos", hours: "", hero: { heading: "H", body: undefined } } as Storefront,
      } as unknown as Store;

      await expect(projectPublicForStore(store, [] as Product[], [] as Category[])).resolves.toBeUndefined();

      const pub = (await getDoc(doc(db, "publicStores/olivia-emul2"))).data()!;
      expect(pub.storefront.shipping).toBe("Envíos");
      expect(pub.storefront.notice).toBeUndefined(); // undefined anidado: fuera
      expect(pub.storefront.hours).toBeUndefined(); // "" → deleteField, no ""
    });
  });
});

// #374 r2 — discrimination probe for the UX review findings: does the RENAME
// data path (claim → stores patch → unproject old → project new) survive the
// hardened rules when run AS THE OWNER? If this passes, the "false error on
// rename" / "dead link until manual republish" symptoms are app-level (to be
// filed separately), not rules regressions from #374.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#374 r2 — renombre end-to-end a nivel datos (dueña, reglas vigentes)", () => {
  const R2_OWNER = "sf-r2-owner";
  const R2_STORE = "sf-r2-store";
  const OLD_SLUG = "r2-old";
  const NEW_SLUG = "r2-new";
  const holder2 = holder;
  let envRename: RulesTestEnvironment;

  beforeAll(async () => {
    envRename = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf-8") },
    });
    // Isolated project id per suite: never collide with the #332 seeds above.
    await envRename.clearFirestore();
    await envRename.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, `users/${R2_OWNER}`), { role: "member" });
      await setDoc(doc(db, `adminStores/${R2_STORE}`), { ownerUid: R2_OWNER, memberUids: [R2_OWNER] });
      await setDoc(doc(db, `stores/${R2_STORE}`), {
        slug: OLD_SLUG, name: "R2", type: "on_demand",
        ownerUid: R2_OWNER, memberUids: [R2_OWNER], createdAt: "", updatedAt: "",
      });
      await setDoc(doc(db, `slugs/${OLD_SLUG}`), { storeId: R2_STORE, ownerUid: R2_OWNER, claimedAt: 0 });
      await setDoc(doc(db, `publicStores/${OLD_SLUG}`), { storeId: R2_STORE, slug: OLD_SLUG, name: "R2" });
      await setDoc(doc(db, `publicCatalogs/${OLD_SLUG}`), { storeId: R2_STORE, categories: [], products: [] });
      await setDoc(doc(db, `publicProducts/${R2_STORE}__p1`), {
        storeId: R2_STORE, storeSlug: OLD_SLUG, productSlug: "p1", name: "P1",
      });
    });
  });

  it("claim → stores patch → desproyección → proyección nueva: todo pasa como dueña", async () => {
    holder2.db = envRename.authenticatedContext(R2_OWNER).firestore();
    holder2.uid = R2_OWNER;
    const existing = { id: R2_STORE, slug: OLD_SLUG, name: "R2", type: "on_demand" } as unknown as Store;
    const renamed = { ...existing, slug: NEW_SLUG } as Store;

    // The exact updateStore sequence (StoreProvider.updateStore, slugChanged).
    const { claimSlug, unprojectPublicForStore } = await import("./firestoreData");
    const { updateDoc: sdkUpdate } = await import("firebase/firestore");
    await claimSlug(NEW_SLUG, R2_STORE);
    await sdkUpdate(doc(holder2.db as any, `stores/${R2_STORE}`), { slug: NEW_SLUG, updatedAt: "2026-11-14T00:00:00.000Z" });
    await unprojectPublicForStore(existing);
    await projectPublicForStore(renamed, [] as Product[], [] as Category[]);

    const newStore = await getDoc(doc(holder2.db as any, `publicStores/${NEW_SLUG}`));
    expect(newStore.exists()).toBe(true);
    const oldStore = await getDoc(doc(holder2.db as any, `publicStores/${OLD_SLUG}`));
    expect(oldStore.exists()).toBe(false);
    const newCat = await getDoc(doc(holder2.db as any, `publicCatalogs/${NEW_SLUG}`));
    expect(newCat.exists()).toBe(true);
    const reservation = await getDoc(doc(holder2.db as any, `slugs/${NEW_SLUG}`));
    expect((reservation.data() as any)?.storeId).toBe(R2_STORE);
  });

  afterAll(async () => {
    await envRename?.cleanup();
  });
});
