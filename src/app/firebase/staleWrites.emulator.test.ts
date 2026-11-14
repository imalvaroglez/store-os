import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { Product, Purchase } from "../../types";

// #373: full-document writes from STALE clones silently revert concurrent
// canonical changes (members added, stock received, expenses assigned).
// These suites reproduce each surface with two synthetic sessions and pin
// the patch-based contracts.

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import {
  applyMembershipChangeTx,
  receivePurchaseTx,
  saveProductPreservingConcurrentTx,
  savePurchaseTx,
  StalePurchaseError,
} from "./firestoreData";

let env: RulesTestEnvironment;

const NOW = "2026-11-13T10:00:00.000Z";

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#373 stale full-doc writes", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users/tx-user"), { role: "member" });
      await setDoc(doc(db, "users/tx-owner"), { role: "member" });
      await setDoc(doc(db, "users/tx-u2"), { role: "member" });
      await setDoc(doc(db, "users/tx-u3"), { role: "member" });
      // Hermetic per run: a long-lived emulator may hold docs from a previous
      // suite execution (revisions would make every create look stale).
      for (const id of ["sw-pur1", "sw-pur2", "sw-pur3", "sw-pur-exp", "sw-pur-asg", "sw-pur-recv", "sw-pur-legacy"]) await deleteDoc(doc(db, "purchases", id));
      await deleteDoc(doc(db, "products", "sw-p1"));
      await deleteDoc(doc(db, "products", "sw-p2"));
      await setDoc(doc(db, "adminStores/sw-store"), { ownerUid: "tx-owner", memberUids: ["tx-owner", "tx-user"], createdAt: NOW, updatedAt: NOW });
      await setDoc(doc(db, "stores/sw-store"), {
        name: "Tienda SW", slug: "sw", type: "inventory_tiered",
        ownerUid: "tx-owner", memberUids: ["tx-owner", "tx-user"],
        createdAt: NOW, updatedAt: NOW,
      });
    });
    holder.db = env.authenticatedContext("tx-owner").firestore();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  // ── Corte 1: membresías — solo el parche, nunca la tienda completa ──────

  it("removeMember desde un clon vencido NO expulsa a la miembro agregada en paralelo", async () => {
    // Sesión A (vencida) cree: owner + tx-user. Sesión B agregó a tx-u2 mientras tanto.
    await applyMembershipChangeTx("sw-store", { kind: "invite", email: "nueva@tienda.mx" });
    await env.withSecurityRulesDisabled(async (ctx) => {
      // reconcile happened elsewhere: the invitee is now a member, added AFTER
      // session A loaded its clone.
      await setDoc(doc(ctx.firestore(), "adminStores/sw-store"), { ownerUid: "tx-owner", memberUids: ["tx-owner", "tx-user", "tx-u2"], pendingInvites: [] }, { merge: true });
      await setDoc(doc(ctx.firestore(), "stores/sw-store"), { memberUids: ["tx-owner", "tx-user", "tx-u2"] }, { merge: true });
    });
    // Session A (stale clone listing only owner+tx-user) removes tx-user.
    await applyMembershipChangeTx("sw-store", { kind: "remove", memberUid: "tx-user" });
    const store = (await getDoc(doc(holder.db, "stores/sw-store"))).data()!;
    const admin = (await getDoc(doc(holder.db, "adminStores/sw-store"))).data()!;
    // tx-user left; tx-u2 (added concurrently) SURVIVES in BOTH planes.
    expect(store.memberUids).toEqual(["tx-owner", "tx-u2"]);
    expect(admin.memberUids).toEqual(["tx-owner", "tx-u2"]);
  });

  it("invitar con arrayUnion conserva invitaciones concurrentes; ambas planeas quedan iguales", async () => {
    // Self-contained start: clean invites on BOTH planes (test order must not matter).
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "stores/sw-store"), { pendingInvites: [] }, { merge: true });
      await setDoc(doc(ctx.firestore(), "adminStores/sw-store"), { pendingInvites: [] }, { merge: true });
    });
    await applyMembershipChangeTx("sw-store", { kind: "invite", email: "uno@tienda.mx" });
    await applyMembershipChangeTx("sw-store", { kind: "invite", email: "dos@tienda.mx" });
    const store = (await getDoc(doc(holder.db, "stores/sw-store"))).data()!;
    const admin = (await getDoc(doc(holder.db, "adminStores/sw-store"))).data()!;
    expect(store.pendingInvites).toEqual(expect.arrayContaining(["uno@tienda.mx", "dos@tienda.mx"]));
    expect(admin.pendingInvites).toEqual(store.pendingInvites);
  });

  it("transferir propiedad valida contra el estado VIGENTE, no el clon", async () => {
    // tx-u3 fue agregada en paralelo (no está en ningún clon viejo): la
    // transferencia hacia ella debe funcionar porque el doc vigente la tiene.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "adminStores/sw-store"), { ownerUid: "tx-owner", memberUids: ["tx-owner", "tx-u2", "tx-u3"] }, { merge: true });
      await setDoc(doc(ctx.firestore(), "stores/sw-store"), { ownerUid: "tx-owner", memberUids: ["tx-owner", "tx-u2", "tx-u3"] }, { merge: true });
    });
    await applyMembershipChangeTx("sw-store", { kind: "transfer", memberUid: "tx-u3" });
    const store = (await getDoc(doc(holder.db, "stores/sw-store"))).data()!;
    const admin = (await getDoc(doc(holder.db, "adminStores/sw-store"))).data()!;
    expect(store.ownerUid).toBe("tx-u3");
    expect(admin.ownerUid).toBe("tx-u3");
    // Regresa la propiedad a tx-owner y retira a tx-u3 en paralelo: transferir
    // hacia quien ya NO es miembro se rechaza contra el estado vigente.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "adminStores/sw-store"), { ownerUid: "tx-owner", memberUids: ["tx-owner", "tx-u2"] }, { merge: true });
      await setDoc(doc(ctx.firestore(), "stores/sw-store"), { ownerUid: "tx-owner", memberUids: ["tx-owner", "tx-u2"] }, { merge: true });
    });
    await expect(
      applyMembershipChangeTx("sw-store", { kind: "transfer", memberUid: "tx-u3" })
    ).rejects.toThrow(/miembro/);
    // Sacar a la dueña actual se rechaza con salida clara.
    await expect(
      applyMembershipChangeTx("sw-store", { kind: "remove", memberUid: "tx-owner" })
    ).rejects.toThrow(/dueña|propiedad/i);
  });

  // ── Corte 2: productos — merge de campos operativos contra el doc fresco ──

  const baseProduct = { storeId: "sw-store", name: "Aro Sol", category: "other", isPublic: true, createdAt: NOW, updatedAt: NOW };

  it("guardar el editor sin tocar existencias conserva la recepción concurrente (+3)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/sw-p1"), { ...baseProduct, quantityOnHand: 5, cost: 100 });
    });
    const baseline = { ...baseProduct, id: "sw-p1", quantityOnHand: 5, cost: 100 } as unknown as Product;
    // La otra sesión recibió compra: +3 piezas y costo promediado.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/sw-p1"), { quantityOnHand: 8, cost: 116 }, { merge: true });
    });
    const next = { ...baseline, name: "Aro Luna", quantityOnHand: 5, cost: 100 } as Product; // formulario sin tocar stock/costo
    const saved = await saveProductPreservingConcurrentTx(baseline, next);
    expect(saved.quantityOnHand).toBe(8); // la recepción sobrevive
    expect(saved.cost).toBe(116);
    expect(saved.name).toBe("Aro Luna"); // el cambio del editor aterriza
    const docData = (await getDoc(doc(holder.db, "products/sw-p1"))).data()!;
    expect(docData.quantityOnHand).toBe(8);
    expect(docData.name).toBe("Aro Luna");
  });

  it("ajuste manual de existencias aterriza como delta sobre lo fresco; variantes por color igual", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/sw-p2"), {
        ...baseProduct,
        quantityOnHand: 5,
        variants: [
          { id: "v1", color: "Dorado", quantityOnHand: 4, createdAt: NOW, updatedAt: NOW },
          { id: "v2", color: "Plata", quantityOnHand: 2, createdAt: NOW, updatedAt: NOW },
        ],
      });
      // Recepción concurrente: +3 Dorado.
      await setDoc(doc(ctx.firestore(), "products/sw-p2"), {
        variants: [
          { id: "v1", color: "Dorado", quantityOnHand: 7, createdAt: NOW, updatedAt: NOW },
          { id: "v2", color: "Plata", quantityOnHand: 2, createdAt: NOW, updatedAt: NOW },
        ],
      }, { merge: true });
    });
    const baseline = {
      ...baseProduct, id: "sw-p2", quantityOnHand: 5,
      variants: [
        { id: "v1", color: "Dorado", quantityOnHand: 4, createdAt: NOW, updatedAt: NOW },
        { id: "v2", color: "Plata", quantityOnHand: 2, createdAt: NOW, updatedAt: NOW },
      ],
    } as unknown as Product;
    // La operadora ajusta Dorado 4→5 (+1 manual) y no toca Plata.
    const next = {
      ...baseline,
      variants: [
        { id: "v1", color: "Dorado", quantityOnHand: 5, createdAt: NOW, updatedAt: NOW },
        { id: "v2", color: "Plata", quantityOnHand: 2, createdAt: NOW, updatedAt: NOW },
      ],
    } as Product;
    const saved = await saveProductPreservingConcurrentTx(baseline, next);
    const byColor = new Map(saved.variants!.map((v) => [v.color, v.quantityOnHand]));
    expect(byColor.get("Dorado")).toBe(8); // fresco 7 + intencional 1
    expect(byColor.get("Plata")).toBe(2);
  });

  // ── Corte 3: compras — revisión + rechazo stale + evidencia verbatim ────

  const basePurchase = { storeId: "sw-store", supplierId: "sup1", date: "2026-11-12", status: "draft", lines: [], createdAt: NOW, updatedAt: NOW };

  it("dos ediciones: la segunda con revisión vencida se rechaza sin tocar el doc", async () => {
    const created = await savePurchaseTx({ ...basePurchase, id: "sw-pur1" } as unknown as Purchase, null);
    expect(created.revision).toBe(1);
    const first = await savePurchaseTx({ ...created, notes: "edit sesión A" } as Purchase, 1);
    expect(first.revision).toBe(2);
    // Sesión B aún cree que la revisión es 1 (clon vencido).
    await expect(
      savePurchaseTx({ ...created, notes: "edit sesión B (vencida)" } as Purchase, 1)
    ).rejects.toBeInstanceOf(StalePurchaseError);
    const docData = (await getDoc(doc(holder.db, "purchases/sw-pur1"))).data()!;
    expect(docData.notes).toBe("edit sesión A");
    expect(docData.revision).toBe(2);
  });

  it("el gasto de surtido asignado en paralelo sobrevive al guardado del formulario", async () => {
    const created = await savePurchaseTx({ ...basePurchase, id: "sw-pur2" } as unknown as Purchase, null);
    // assignExpenseTx anexó evidencia en paralelo.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "purchases/sw-pur2"), {
        sourcingExpenses: [{ id: "exp1", category: "sourcing_transport", amount: 33, description: "Transporte" }],
      }, { merge: true });
    });
    const saved = await savePurchaseTx({ ...created, notes: "edit de la operadora" } as Purchase, created.revision ?? 1);
    expect(saved.notes).toBe("edit de la operadora");
    const docData = (await getDoc(doc(holder.db, "purchases/sw-pur2"))).data()!;
    expect(docData.sourcingExpenses).toHaveLength(1); // la evidencia concurrente sobrevive
    expect(docData.sourcingExpenses[0].amount).toBe(33);
  });

  // ── #373 ronda 2: el formulario ES dueño de sus gastos de surtido ─────────
  // (agregar/editar/quitar); lo asignado en paralelo (otra pestaña, la vía
  // nativa de gastos) viaja con el guardado. Antes: el segundo guardado
  // revertía la edición con toast de éxito.

  it("el segundo guardado conserva agregar, editar y quitar gastos del formulario", async () => {
    const e1 = { id: "e1", category: "sourcing_transport" as const, amount: 44 };
    const created = await savePurchaseTx({ ...basePurchase, id: "sw-pur-exp", sourcingExpenses: [e1] } as unknown as Purchase, null);
    // Agregar e2 y editar e1 44→50, con el baseline que cargó el formulario.
    const saved2 = await savePurchaseTx(
      { ...created, sourcingExpenses: [{ ...e1, amount: 50 }, { id: "e2", category: "other" as const, amount: 33 }] } as Purchase,
      created.revision ?? 1,
      created
    );
    expect(saved2.sourcingExpenses).toEqual([{ ...e1, amount: 50 }, { id: "e2", category: "other", amount: 33 }]);
    // Quitar e1: el doc queda solo con e2.
    const saved3 = await savePurchaseTx(
      { ...saved2, sourcingExpenses: [{ id: "e2", category: "other", amount: 33 }] } as Purchase,
      saved2.revision ?? 2,
      saved2
    );
    expect(saved3.sourcingExpenses).toEqual([{ id: "e2", category: "other", amount: 33 }]);
    const docData = (await getDoc(doc(holder.db, "purchases/sw-pur-exp"))).data()!;
    expect(docData.sourcingExpenses).toHaveLength(1);
    expect(docData.sourcingExpenses[0].amount).toBe(33);
  });

  it("una asignación concurrente (no vista por el formulario) sobrevive a su edición", async () => {
    const e1 = { id: "e1", category: "sourcing_transport" as const, amount: 44 };
    const created = await savePurchaseTx({ ...basePurchase, id: "sw-pur-asg", sourcingExpenses: [e1] } as unknown as Purchase, null);
    // La otra pestaña anexó evidencia asignada (vía assignExpenseTx).
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "purchases/sw-pur-asg"), {
        sourcingExpenses: [e1, { id: "asg_1", category: "sourcing_transport" as const, amount: 60, description: "Transporte asignado" }],
      }, { merge: true });
    });
    const saved = await savePurchaseTx(
      { ...created, sourcingExpenses: [{ ...e1, amount: 50 }] } as Purchase, // el formulario editó SU gasto
      created.revision ?? 1,
      created
    );
    expect(saved.sourcingExpenses).toEqual([
      { ...e1, amount: 50 },
      { id: "asg_1", category: "sourcing_transport", amount: 60, description: "Transporte asignado" },
    ]);
  });

  it("recibir mercancía con el gasto añadido: la evidencia del gasto sobrevive a la recepción", async () => {
    const e1 = { id: "e1", category: "sourcing_transport" as const, amount: 50, includeInInventoryCost: true };
    const created = await savePurchaseTx({ ...basePurchase, id: "sw-pur-recv", lines: [], sourcingExpenses: [e1] } as unknown as Purchase, null);
    const saved = await savePurchaseTx({ ...created, notes: "edit" } as Purchase, created.revision ?? 1, created);
    await receivePurchaseTx("sw-pur-recv");
    const docData = (await getDoc(doc(holder.db, "purchases/sw-pur-recv"))).data()!;
    expect(docData.status).toBe("received");
    expect(docData.sourcingExpenses).toEqual([e1]); // ni perdido ni duplicado por la recepción
    expect(saved.notes).toBe("edit");
  });

  it("regla: una compra legada SIN campo status es evidencia inmutable (solo ajuste de venta)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "purchases/sw-pur-legacy"), {
        storeId: "sw-store", lines: [], createdAt: NOW, updatedAt: NOW,
        // sin status ni revision: legado cuyo inventario ya se aplicó al guardar
      });
    });
    const parent = doc(holder.db, "purchases/sw-pur-legacy");
    await expect(updateDoc(parent, { notes: "cambio" })).rejects.toThrow();
    // La única mutación permitida sobre evidencia recibida: el ajuste de venta.
    await updateDoc(parent, { saleCostAdjustments: [{ id: "adj1", amount: 10, note: "Ajuste", by: "tx-owner", at: NOW }], updatedAt: NOW });
    const docData = (await getDoc(parent)).data()!;
    expect(docData.saleCostAdjustments).toHaveLength(1);
    expect(docData.notes).toBeUndefined();
  });

  it("crear con revisión esperada se rechaza; la compra nueva arranca en revisión 1", async () => {
    await expect(
      savePurchaseTx({ ...basePurchase, id: "sw-pur3" } as unknown as Purchase, 4)
    ).rejects.toBeInstanceOf(StalePurchaseError);
    expect((await getDoc(doc(holder.db, "purchases/sw-pur3"))).exists()).toBe(false);
  });
});
