import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { readFileSync } from "node:fs";

// #132 (FER-17): confirmed monthly rankings are append-only evidence — ONLY
// the store's owner (Fer) confirms; nobody edits or deletes history; members
// can read their store's confirmations; foreign users see nothing.

const holder = vi.hoisted(() => ({ db: null as any, uid: undefined as string | undefined }));
vi.mock("./config", () => ({
  getFirebase: () => ({ db: holder.db, auth: { currentUser: holder.uid ? { uid: holder.uid } : null } }),
}));

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#132 confirmaciones de ranking", () => {
  let env: RulesTestEnvironment;
  const STORE = "rk-store";
  const OWNER = "rk-owner";
  const MEMBER = "rk-member";
  const FOREIGN = "rk-foreign";
  const NOW = "2026-11-14T21:00:00.000Z";

  const confirmation = (id: string, storeId: string, confirmedBy: string, extra: Record<string, unknown> = {}) => ({
    id, storeId, year: 2026, month: 10, revision: 1,
    entries: [{ customerId: "c1", name: "Ana", netCents: 300000, pieces: 5, rank: 1 }],
    tieResolutions: [], confirmedBy, confirmedAt: NOW, ...extra,
  });

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf-8") },
    });
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, `users/${OWNER}`), { role: "member" });
      await setDoc(doc(fs, `users/${MEMBER}`), { role: "member" });
      await setDoc(doc(fs, `adminStores/${STORE}`), { ownerUid: OWNER, memberUids: [OWNER, MEMBER] });
    });
  });
  afterAll(async () => { await env?.cleanup(); });

  it("la dueña crea su confirmación; el id debe ser el del cuerpo", async () => {
    const dbOwner = env.authenticatedContext(OWNER).firestore();
    const record = confirmation(`${STORE}__2026-10`, STORE, OWNER);
    await setDoc(doc(dbOwner, `rankingConfirmations/${record.id}`), record as never);
    const read = (await getDoc(doc(dbOwner, `rankingConfirmations/${record.id}`))).data();
    expect(read?.storeId).toBe(STORE);
    // id del cuerpo distinto al del path: rechazado.
    const mismatched = confirmation("otro_id", STORE, OWNER);
    await expect(setDoc(doc(dbOwner, "rankingConfirmations/whatever"), mismatched as never)).rejects.toThrow();
  });

  it("una colaboradora NO confirma (solo la dueña); puede LEER su tienda", async () => {
    const dbMember = env.authenticatedContext(MEMBER).firestore();
    const record = confirmation(`${STORE}__2026-11`, STORE, MEMBER);
    await expect(setDoc(doc(dbMember, `rankingConfirmations/${record.id}`), record as never)).rejects.toThrow();
    // lectura de su propia tienda (consulta acotada por tienda, como la app): permitida.
    const owner = env.authenticatedContext(OWNER).firestore();
    await setDoc(doc(owner, `rankingConfirmations/${STORE}__2026-10x`), confirmation(`${STORE}__2026-10x`, STORE, OWNER) as never);
    const snap = await getDocs(query(collection(dbMember, "rankingConfirmations"), where("storeId", "==", STORE)));
    expect(snap.docs.length).toBeGreaterThan(0);
  });

  it("ajena no lee ni lista; el historial es inmutable (update/delete denegados)", async () => {
    const foreign = env.authenticatedContext(FOREIGN).firestore();
    await expect(getDoc(doc(foreign, `rankingConfirmations/${STORE}__2026-10`))).rejects.toThrow();
    await expect(getDocs(collection(foreign, "rankingConfirmations"))).rejects.toThrow();
    const owner = env.authenticatedContext(OWNER).firestore();
    await expect(updateDoc(doc(owner, `rankingConfirmations/${STORE}__2026-10`), { entries: [] })).rejects.toThrow();
    await expect(deleteDoc(doc(owner, `rankingConfirmations/${STORE}__2026-10`))).rejects.toThrow();
  });
});
