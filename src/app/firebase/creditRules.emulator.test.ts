import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { Order, OrderCreditLedgerEntry } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import {
  applyCustomerCreditTx,
  releaseCustomerCreditTx,
  saveOrderWithStockTx,
} from "./firestoreData";

let env: RulesTestEnvironment;

const user = { uid: "tx-user", role: "member" } as never;

const orderDoc = (id: string, extra: Record<string, unknown> = {}) => ({
  storeId: "cr-store",
  customerId: "cr-clienta",
  items: [{ lineId: `${id}_L0`, productName: "Pieza", quantity: 1, unitPrice: 200, subtotal: 200 }],
  deposit: 0,
  orderStatus: "confirmed",
  revision: 0,
  createdAt: "2026-11-12T10:00:00.000Z",
  updatedAt: "2026-11-12T10:00:00.000Z",
  ...extra,
});

const entry = (id: string, amountCents: number, fromOrderId: string, kind: OrderCreditLedgerEntry["kind"] = "application"): OrderCreditLedgerEntry => ({
  id, kind, fromOrderId, amountCents, at: "2026-11-12T10:05:00.000Z", by: "tx-user",
});

// Runs in CI's rules job (emulator); skipped locally without FIRESTORE_EMULATOR_HOST.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#380 — saldo a favor solo mediante operaciones firmadas y trazables", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users/tx-user"), { role: "member" });
      await setDoc(doc(db, "adminStores/cr-store"), { ownerUid: "tx-user", memberUids: ["tx-user"] });
      await setDoc(doc(db, "adminStores/cr-foreign"), { ownerUid: "someone", memberUids: ["someone"] });
      // Overpaid origin: $200 total, $400 received → $200 of clienta credit.
      await setDoc(doc(db, "orders/cr-origin"), orderDoc("cr-origin", {
        items: [{ lineId: "cr-origin_L0", productName: "Anillo", quantity: 1, unitPrice: 200, subtotal: 200 }],
        paymentsReceivedCents: 40000,
        inheritedDepositMaterialized: true,
      }));
      // Destination owing $500 (room for two credit applications).
      await setDoc(doc(db, "orders/cr-dest"), orderDoc("cr-dest", {
        items: [{ lineId: "cr-dest_L0", productName: "Pieza", quantity: 1, unitPrice: 500, subtotal: 500 }],
      }));
      // A cross-clienta sister (same store, other clienta) for isolation probes.
      await setDoc(doc(db, "orders/cr-other-clienta"), { ...orderDoc("cr-other-clienta", { paymentsReceivedCents: 40000, inheritedDepositMaterialized: true }), customerId: "cr-otra" });
      // A foreign-store order for cross-store probes.
      await setDoc(doc(db, "orders/cr-foreign-order"), { ...orderDoc("cr-foreign-order", { paymentsReceivedCents: 40000, inheritedDepositMaterialized: true }), storeId: "cr-foreign" });
    });
    holder.db = env.authenticatedContext("tx-user").firestore();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  // ── Legit flow first: it builds the state the abuse matrix attacks. ──
  it("applyCustomerCreditTx deja evidencia firmada en AMBOS pedidos y pasa las reglas", async () => {
    await applyCustomerCreditTx({ entry: entry("app_1", 20000, "cr-origin"), orderId: "cr-dest", storeId: "cr-store" });
    const dest = (await getDoc(doc(holder.db, "orders/cr-dest"))).data()!;
    const origin = (await getDoc(doc(holder.db, "orders/cr-origin"))).data()!;
    expect(dest.creditAppliedCents).toBe(20000);
    expect((dest.creditLedger as OrderCreditLedgerEntry[]).find((e) => e.id === "app_1")?.kind).toBe("application");
    expect(origin.creditConsumedCents).toBe(20000);
    const mirror = (origin.creditLedger as OrderCreditLedgerEntry[]).find((e) => e.id === "con_app_1");
    expect(mirror).toMatchObject({ kind: "consumption", fromOrderId: "cr-dest", amountCents: 20000 });
  });

  it("un guardado ordinario (saveOrderWithStockTx) arrastra el crédito verbatim y pasa las reglas", async () => {
    const before = (await getDoc(doc(holder.db, "orders/cr-dest"))).data()!;
    const edited = {
      id: "cr-dest", storeId: "cr-store", customerId: "cr-clienta",
      items: before.items, deposit: 0, orderStatus: "confirmed",
      revision: before.revision, creditAppliedCents: before.creditAppliedCents,
      creditLedger: before.creditLedger,
      notes: "edición ordinaria con crédito intacto",
      createdAt: "2026-11-12T10:00:00.000Z", updatedAt: "2026-11-12T10:00:00.000Z",
    } as never as Order;
    const saved = await saveOrderWithStockTx(user, edited, before.revision, "cr-edit-verbatim");
    expect(saved.order.notes).toBe("edición ordinaria con crédito intacto");
    expect(saved.order.creditAppliedCents).toBe(20000); // verbatim
  });

  // ── Abuse matrix: every SDK-only manipulation of the credit dies. ──
  it("SDK: poner creditAppliedCents en 0 (eludir el guard de borrado #363) → DENEGADO", async () => {
    await expect(updateDoc(doc(holder.db, "orders/cr-dest"), { creditAppliedCents: 0 })).rejects.toThrow();
  });

  it("SDK: inventar crédito (creditConsumedCents +999999 sin ledger) → DENEGADO", async () => {
    await expect(updateDoc(doc(holder.db, "orders/cr-origin"), { creditConsumedCents: 999999 })).rejects.toThrow();
  });

  it("SDK: reescribir una entrada del ledger (cambiar importe) → DENEGADO", async () => {
    const dest = (await getDoc(doc(holder.db, "orders/cr-dest"))).data()!;
    const tampered = (dest.creditLedger as OrderCreditLedgerEntry[]).map((e) =>
      e.id === "app_1" ? { ...e, amountCents: 1 } : e
    );
    await expect(updateDoc(doc(holder.db, "orders/cr-dest"), { creditLedger: tampered })).rejects.toThrow();
  });

  it("SDK: borrar una entrada del ledger → DENEGADO", async () => {
    await expect(updateDoc(doc(holder.db, "orders/cr-dest"), { creditLedger: [] })).rejects.toThrow();
  });

  it("SDK: entrada firmada por OTRO uid aunque mueva el acumulador → DENEGADO", async () => {
    const origin = (await getDoc(doc(holder.db, "orders/cr-origin"))).data()!;
    await expect(updateDoc(doc(holder.db, "orders/cr-origin"), {
      creditConsumedCents: 30000,
      creditLedger: [...(origin.creditLedger as OrderCreditLedgerEntry[]), { ...entry("con_fake", 10000, "cr-dest", "consumption"), by: "otra-persona" }],
    })).rejects.toThrow();
  });

  it("SDK: entrada propia pero con DIRECCIÓN contraria (sube aplicado con kind release) → DENEGADO", async () => {
    const dest = (await getDoc(doc(holder.db, "orders/cr-dest"))).data()!;
    await expect(updateDoc(doc(holder.db, "orders/cr-dest"), {
      creditAppliedCents: 30000,
      creditLedger: [...(dest.creditLedger as OrderCreditLedgerEntry[]), { ...entry("app_fake_dir", 10000, "cr-origin"), by: "tx-user", kind: "release" }],
    })).rejects.toThrow();
  });

  it("SDK: contra-pedido INEXISTENTE (get falla) → DENEGADO", async () => {
    const dest = (await getDoc(doc(holder.db, "orders/cr-dest"))).data()!;
    await expect(updateDoc(doc(holder.db, "orders/cr-dest"), {
      creditAppliedCents: 30000,
      creditLedger: [...(dest.creditLedger as OrderCreditLedgerEntry[]), { ...entry("app_ghost", 10000, "cr-no-existe"), by: "tx-user" }],
    })).rejects.toThrow();
  });

  it("SDK: aislamiento por CLIENTA — entrada contra un pedido de otra clienta → DENEGADO", async () => {
    const dest = (await getDoc(doc(holder.db, "orders/cr-dest"))).data()!;
    await expect(updateDoc(doc(holder.db, "orders/cr-dest"), {
      creditAppliedCents: 30000,
      creditLedger: [...(dest.creditLedger as OrderCreditLedgerEntry[]), { ...entry("app_xclienta", 10000, "cr-other-clienta"), by: "tx-user" }],
    })).rejects.toThrow();
  });

  it("SDK: aislamiento por TIENDA — escribir crédito de un pedido ajeno → DENEGADO", async () => {
    // cr-foreign-order belongs to cr-foreign: the member cannot even update it.
    await expect(updateDoc(doc(holder.db, "orders/cr-foreign-order"), { creditConsumedCents: 500 })).rejects.toThrow();
  });

  it("SDK: crear un pedido NUEVO con crédito ya fabricado → DENEGADO", async () => {
    await expect(setDoc(doc(holder.db, "orders/cr-fabricated"), {
      ...orderDoc("cr-fabricated"), creditAppliedCents: 50000,
    })).rejects.toThrow();
  });

  it("SDK: magnitud fabricada — entrada válida de 1 centavo que 'justifica' +100 pesos → DENEGADO", async () => {
    const dest = (await getDoc(doc(holder.db, "orders/cr-dest"))).data()!;
    await expect(updateDoc(doc(holder.db, "orders/cr-dest"), {
      creditAppliedCents: (dest.creditAppliedCents as number) + 10000,
      creditLedger: [...(dest.creditLedger as OrderCreditLedgerEntry[]), { ...entry("app_mag_fraud", 1, "cr-origin"), by: "tx-user" }],
    })).rejects.toThrow();
  });

  it("SDK: lote cuya suma NO cuadra con el delta (60+40 moviendo 200) → DENEGADO", async () => {
    const dest = (await getDoc(doc(holder.db, "orders/cr-dest"))).data()!;
    const base = dest.creditLedger as OrderCreditLedgerEntry[];
    await expect(updateDoc(doc(holder.db, "orders/cr-dest"), {
      creditAppliedCents: (dest.creditAppliedCents as number) - 20000,
      creditLedger: [
        ...base,
        { ...entry("rel_sum_a", 6000, "cr-origin", "release"), by: "tx-user" },
        { ...entry("rel_sum_b", 4000, "cr-origin", "release"), by: "tx-user" },
      ],
    })).rejects.toThrow();
  });

  it("SDK: lote con entrada intermedia malformada aunque la última sea válida → DENEGADO", async () => {
    const dest = (await getDoc(doc(holder.db, "orders/cr-dest"))).data()!;
    const base = dest.creditLedger as OrderCreditLedgerEntry[];
    await expect(updateDoc(doc(holder.db, "orders/cr-dest"), {
      creditAppliedCents: (dest.creditAppliedCents as number) - 7000,
      creditLedger: [
        ...base,
        { kind: "release", fromOrderId: "cr-origin", amountCents: 3000 } as never as OrderCreditLedgerEntry, // sin id/at/by
        { ...entry("rel_mid_ok", 4000, "cr-origin", "release"), by: "tx-user" },
      ],
    })).rejects.toThrow();
  });

  it("SDK: borrar el pedido con crédito pendiente sigue DENEGADO (#363 intacto)", async () => {
    await expect(deleteDoc(doc(holder.db, "orders/cr-dest"))).rejects.toThrow();
  });
  it("flujo legítimo multi-origen: dos aplicaciones → cancelación restituye a ambos orígenes con espejos", async () => {
    // Second overpaid origin for the same clienta.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/cr-origin2"), orderDoc("cr-origin2", {
        items: [{ lineId: "cr-origin2_L0", productName: "Anillo 2", quantity: 1, unitPrice: 200, subtotal: 200 }],
        paymentsReceivedCents: 30000,
        inheritedDepositMaterialized: true,
      }));
    });
    await applyCustomerCreditTx({ entry: entry("app_2", 10000, "cr-origin2"), orderId: "cr-dest", storeId: "cr-store" });
    // Cancel the destination: the release must restitute BOTH origins in one
    // transaction — a multi-entry batch that the strict exact-sum rules allow.
    await updateDoc(doc(holder.db, "orders/cr-dest"), { orderStatus: "cancelled" }).catch(() => {});
    const released = await releaseCustomerCreditTx({ orderId: "cr-dest", storeId: "cr-store", by: "tx-user" });
    expect(released).toBe(30000);
    const dest = (await getDoc(doc(holder.db, "orders/cr-dest"))).data()!;
    expect(dest.creditAppliedCents).toBe(0);
    const o1 = (await getDoc(doc(holder.db, "orders/cr-origin"))).data()!;
    const o2 = (await getDoc(doc(holder.db, "orders/cr-origin2"))).data()!;
    expect(o1.creditConsumedCents).toBe(0);
    expect(o2.creditConsumedCents).toBe(0);
    expect((o1.creditLedger as OrderCreditLedgerEntry[]).some((e) => e.kind === "restitution")).toBe(true);
    expect((o2.creditLedger as OrderCreditLedgerEntry[]).some((e) => e.kind === "restitution")).toBe(true);
  });

  it("#403 MAYOR-1: cuatro orígenes se restituyen completos vía chunks (reglas de presupuesto CEL)", async () => {
    // Four overpaid origins for the same clienta + one big destination.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      for (const i of [3, 4, 5, 6]) {
        await setDoc(doc(db, "orders/cr-origin" + i), orderDoc("cr-origin" + i, {
          items: [{ lineId: `cr-origin${i}_L0`, productName: "Anillo " + i, quantity: 1, unitPrice: 200, subtotal: 200 }],
          paymentsReceivedCents: 40000,
          inheritedDepositMaterialized: true,
        }));
      }
      await setDoc(doc(db, "orders/cr-dest-many"), orderDoc("cr-dest-many", {
        items: [{ lineId: "cr-dest-many_L0", productName: "Pieza grande", quantity: 2, unitPrice: 500, subtotal: 1000 }],
      }));
    });
    for (const i of [3, 4, 5, 6]) {
      await applyCustomerCreditTx({ entry: entry(`app_many_${i}`, 20000, "cr-origin" + i), orderId: "cr-dest-many", storeId: "cr-store" });
    }
    const dest = (await getDoc(doc(holder.db, "orders/cr-dest-many"))).data()!;
    expect(dest.creditAppliedCents).toBe(80000);
    await updateDoc(doc(holder.db, "orders/cr-dest-many"), { orderStatus: "cancelled" });
    const released = await releaseCustomerCreditTx({ orderId: "cr-dest-many", storeId: "cr-store", by: "tx-user" });
    expect(released).toBe(80000);
    const after = (await getDoc(doc(holder.db, "orders/cr-dest-many"))).data()!;
    expect(after.creditAppliedCents).toBe(0);
    for (const i of [3, 4, 5, 6]) {
      const origin = (await getDoc(doc(holder.db, "orders/cr-origin" + i))).data()!;
      expect(origin.creditConsumedCents).toBe(0);
      expect((origin.creditLedger as OrderCreditLedgerEntry[]).some((e) => e.kind === "restitution")).toBe(true);
    }
  });

  it("#403 r5 P1: cancelación con 6 orígenes restituye completo (chunks de 2)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      for (const i of [7, 8, 9, 10, 11, 12]) {
        await setDoc(doc(db, "orders/cr-origin" + i), orderDoc("cr-origin" + i, {
          items: [{ lineId: `cr-origin${i}_L0`, productName: "Anillo " + i, quantity: 1, unitPrice: 200, subtotal: 200 }],
          paymentsReceivedCents: 40000,
          inheritedDepositMaterialized: true,
        }));
      }
      await setDoc(doc(db, "orders/cr-dest-six"), orderDoc("cr-dest-six", {
        items: [{ lineId: "cr-dest-six_L0", productName: "Pieza grande", quantity: 3, unitPrice: 500, subtotal: 1500 }],
      }));
    });
    for (const i of [7, 8, 9, 10, 11, 12]) {
      await applyCustomerCreditTx({ entry: entry(`app_six_${i}`, 20000, "cr-origin" + i), orderId: "cr-dest-six", storeId: "cr-store" });
    }
    await updateDoc(doc(holder.db, "orders/cr-dest-six"), { orderStatus: "cancelled" });
    const released = await releaseCustomerCreditTx({ orderId: "cr-dest-six", storeId: "cr-store", by: "tx-user" });
    expect(released).toBe(120000);
    const after = (await getDoc(doc(holder.db, "orders/cr-dest-six"))).data()!;
    expect(after.creditAppliedCents).toBe(0);
    for (const i of [7, 8, 9, 10, 11, 12]) {
      const o = (await getDoc(doc(holder.db, "orders/cr-origin" + i))).data()!;
      expect(o.creditConsumedCents).toBe(0);
      expect((o.creditLedger as OrderCreditLedgerEntry[]).some((e) => e.kind === "restitution")).toBe(true);
    }
  });

  it("#403 r5: fabricar par release+espejo sobre un pedido que NO aplicó ese crédito → DENEGADO (acuñación)", async () => {
    // cr-plain never applied anything: before.creditAppliedCents = 0, so a
    // release entry of any size fails the new applied bound.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/cr-plain-victim"), orderDoc("cr-plain-victim"));
    });
    await expect(updateDoc(doc(holder.db, "orders/cr-plain-victim"), {
      creditAppliedCents: -5000,
      creditLedger: [{ id: "release_mint_1", kind: "release", fromOrderId: "cr-origin", amountCents: 5000, at: "2026-11-12T10:00:00.000Z", by: "tx-user" }],
    })).rejects.toThrow();
    const victim = (await getDoc(doc(holder.db, "orders/cr-plain-victim"))).data()!;
    expect(victim.creditAppliedCents ?? 0).toBe(0); // intact
  });

  it("#403 B2: aplicación UNILATERAL (sin par de consumo en el origen) → DENEGADO", async () => {
    const dest = (await getDoc(doc(holder.db, "orders/cr-dest"))).data()!;
    const base = dest.creditLedger as OrderCreditLedgerEntry[];
    await expect(updateDoc(doc(holder.db, "orders/cr-dest"), {
      creditAppliedCents: (dest.creditAppliedCents as number) + 5000,
      creditLedger: [...base, { ...entry("app_unilateral", 5000, "cr-origin"), by: "tx-user" }],
    })).rejects.toThrow(); // no con_<id> mirror committed on cr-origin
  });

  it("#403 B2: restitución UNILATERAL (sin release emparejado en el destino) → DENEGADO", async () => {
    const origin = (await getDoc(doc(holder.db, "orders/cr-origin"))).data()!;
    const base = (origin.creditLedger ?? []) as OrderCreditLedgerEntry[];
    await expect(updateDoc(doc(holder.db, "orders/cr-origin"), {
      creditConsumedCents: (origin.creditConsumedCents as number) - 3000,
      creditLedger: [...base, { id: "res_ghost_release_9", kind: "restitution", fromOrderId: "cr-dest", amountCents: 3000, at: "2026-11-12T10:00:00.000Z", by: "tx-user" }],
    })).rejects.toThrow(); // the paired release entry (id without res_) does not exist on cr-dest
  });

  // ── Evidencia final exigida por el PO (5º bloqueo) ─────────────────────
  it("PO: ninguna operación compromete más saldo del disponible — apply excedente rechazado sin escrituras parciales", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/cr-tight-origin"), orderDoc("cr-tight-origin", {
        items: [{ lineId: "t_L0", productName: "Anillo", quantity: 1, unitPrice: 100, subtotal: 100 }],
        paymentsReceivedCents: 30000, inheritedDepositMaterialized: true, // $300 − $100 → surplus $200
      }));
      await setDoc(doc(ctx.firestore(), "orders/cr-tight-dest"), orderDoc("cr-tight-dest", {
        items: [{ lineId: "td_L0", productName: "Pieza", quantity: 1, unitPrice: 500, subtotal: 500 }],
      }));
    });
    await expect(applyCustomerCreditTx({ entry: entry("app_over", 25000, "cr-tight-origin"), orderId: "cr-tight-dest", storeId: "cr-store" }))
      .rejects.toThrow(/saldo a favor cambió|mayor/i);
    const origin = (await getDoc(doc(holder.db, "orders/cr-tight-origin"))).data()!;
    const dest = (await getDoc(doc(holder.db, "orders/cr-tight-dest"))).data()!;
    expect(origin.creditConsumedCents ?? 0).toBe(0);   // no reservation slipped through
    expect((origin.creditLedger ?? []) as unknown[]).toHaveLength(0);
    expect(dest.creditAppliedCents ?? 0).toBe(0);
    // The fitting amount passes afterwards.
    await applyCustomerCreditTx({ entry: entry("app_fit", 20000, "cr-tight-origin"), orderId: "cr-tight-dest", storeId: "cr-store" });
    const after = (await getDoc(doc(holder.db, "orders/cr-tight-origin"))).data()!;
    expect(after.creditConsumedCents).toBe(20000); // exactly the surplus
  });

  it("PO: dos applies CONCURRENTOS sobre el mismo superávit no comprometen de más (serialización de transacciones)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/cr-race-origin"), orderDoc("cr-race-origin", {
        items: [{ lineId: "r_L0", productName: "Anillo", quantity: 1, unitPrice: 100, subtotal: 100 }],
        paymentsReceivedCents: 30000, inheritedDepositMaterialized: true, // surplus $200
      }));
      for (const d of ["cr-race-dest1", "cr-race-dest2"]) {
        await setDoc(doc(ctx.firestore(), "orders/" + d), orderDoc(d, {
          items: [{ lineId: `${d}_L0`, productName: "Pieza", quantity: 1, unitPrice: 500, subtotal: 500 }],
        }));
      }
    });
    const results = await Promise.allSettled([
      applyCustomerCreditTx({ entry: entry("app_race_1", 20000, "cr-race-origin"), orderId: "cr-race-dest1", storeId: "cr-store" }),
      applyCustomerCreditTx({ entry: entry("app_race_2", 20000, "cr-race-origin"), orderId: "cr-race-dest2", storeId: "cr-store" }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    expect(fulfilled).toBe(1); // only one $20 commitment fits the $20 surplus
    const origin = (await getDoc(doc(holder.db, "orders/cr-race-origin"))).data()!;
    expect(origin.creditConsumedCents).toBe(20000); // never over-committed
    const consumed = origin.creditConsumedCents as number;
    const surplus = 20000;
    expect(consumed).toBeLessThanOrEqual(surplus);
  });

  it("PO: cada movimiento de crédito actualiza la REVISIÓN de ambos pedidos", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/cr-rev-origin"), orderDoc("cr-rev-origin", {
        items: [{ lineId: "rv_L0", productName: "Anillo", quantity: 1, unitPrice: 100, subtotal: 100 }],
        paymentsReceivedCents: 30000, inheritedDepositMaterialized: true, revision: 7, // surplus $200
      }));
      await setDoc(doc(ctx.firestore(), "orders/cr-rev-dest"), orderDoc("cr-rev-dest", {
        items: [{ lineId: "rvd_L0", productName: "Pieza", quantity: 1, unitPrice: 500, subtotal: 500 }],
        revision: 3,
      }));
    });
    await applyCustomerCreditTx({ entry: entry("app_rev", 20000, "cr-rev-origin"), orderId: "cr-rev-dest", storeId: "cr-store" });
    let origin = (await getDoc(doc(holder.db, "orders/cr-rev-origin"))).data()!;
    let dest = (await getDoc(doc(holder.db, "orders/cr-rev-dest"))).data()!;
    expect(origin.revision).toBe(8); // reservation bumped the origin
    expect(dest.revision).toBe(4);   // application bumped the destination
    await updateDoc(doc(holder.db, "orders/cr-rev-dest"), { orderStatus: "cancelled" });
    await releaseCustomerCreditTx({ orderId: "cr-rev-dest", storeId: "cr-store", by: "tx-user" });
    origin = (await getDoc(doc(holder.db, "orders/cr-rev-origin"))).data()!;
    dest = (await getDoc(doc(holder.db, "orders/cr-rev-dest"))).data()!;
    expect(origin.revision).toBe(9); // mirror bumped the origin
    expect(dest.revision).toBe(5);   // release bumped the destination
  });

  it("PO: apply interrumpido tras la fase 1 (reserva sin aplicación) se RECUPERA sin duplicar", async () => {
    // Simulated crash: the origin's consumption mirror committed, the dest
    // application never did (seeded admin-side = exactly the post-phase-1 state).
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/cr-crash-origin"), orderDoc("cr-crash-origin", {
        items: [{ lineId: "cr_L0", productName: "Anillo", quantity: 1, unitPrice: 100, subtotal: 100 }],
        paymentsReceivedCents: 15000, inheritedDepositMaterialized: true,
        creditConsumedCents: 20000,
        creditLedger: [{ id: "con_app_crash", kind: "consumption", fromOrderId: "cr-crash-dest", amountCents: 20000, at: "2026-11-12T10:05:00.000Z", by: "tx-user" }],
      }));
      await setDoc(doc(ctx.firestore(), "orders/cr-crash-dest"), orderDoc("cr-crash-dest", {
        items: [{ lineId: "crd_L0", productName: "Pieza", quantity: 1, unitPrice: 500, subtotal: 500 }],
      }));
    });
    // The retry with the SAME intent completes phase 2; phase 1 no-ops (id).
    await applyCustomerCreditTx({ entry: entry("app_crash", 20000, "cr-crash-origin"), orderId: "cr-crash-dest", storeId: "cr-store" });
    const origin = (await getDoc(doc(holder.db, "orders/cr-crash-origin"))).data()!;
    const dest = (await getDoc(doc(holder.db, "orders/cr-crash-dest"))).data()!;
    expect(origin.creditConsumedCents).toBe(20000); // NOT duplicated
    expect((origin.creditLedger as OrderCreditLedgerEntry[]).filter((e) => e.kind === "consumption")).toHaveLength(1);
    expect(dest.creditAppliedCents).toBe(20000);    // completed
    expect((dest.creditLedger as OrderCreditLedgerEntry[]).filter((e) => e.kind === "application")).toHaveLength(1);
  });

  it("PO: restitución interrumpida tras el release del destino (espejo ausente) se RECUPERA sin duplicar ni dejar saldo varado", async () => {
    // Simulated crash: the dest release committed, the origin mirror never did.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/cr-crash2-origin"), orderDoc("cr-crash2-origin", {
        items: [{ lineId: "c2_L0", productName: "Anillo", quantity: 1, unitPrice: 100, subtotal: 100 }],
        paymentsReceivedCents: 15000, inheritedDepositMaterialized: true,
        creditConsumedCents: 20000, // NOT yet restituted (mirror missing)
      }));
      await setDoc(doc(ctx.firestore(), "orders/cr-crash2-dest"), orderDoc("cr-crash2-dest", {
        items: [{ lineId: "c2d_L0", productName: "Pieza", quantity: 1, unitPrice: 500, subtotal: 500 }],
        orderStatus: "cancelled",
        creditAppliedCents: 0, // the release already landed
        creditLedger: [
          { id: "app_c2", kind: "application", fromOrderId: "cr-crash2-origin", amountCents: 20000, at: "2026-11-12T10:00:00.000Z", by: "tx-user" },
          { id: "release_cr-crash2-dest_cr-crash2-origin_1", kind: "release", fromOrderId: "cr-crash2-origin", amountCents: 20000, at: "2026-11-12T10:10:00.000Z", by: "tx-user" },
        ],
      }));
    });
    // Any later release attempt heals the missing mirror (healing pass).
    const released = await releaseCustomerCreditTx({ orderId: "cr-crash2-dest", storeId: "cr-store", by: "tx-user" });
    expect(released).toBe(0); // nothing NEW to release (net already 0)
    const origin = (await getDoc(doc(holder.db, "orders/cr-crash2-origin"))).data()!;
    const dest = (await getDoc(doc(holder.db, "orders/cr-crash2-dest"))).data()!;
    expect(origin.creditConsumedCents).toBe(0); // healed — no stranded credit
    const mirrors = (origin.creditLedger as OrderCreditLedgerEntry[]).filter((e) => e.kind === "restitution");
    expect(mirrors).toHaveLength(1);
    const releases = (dest.creditLedger as OrderCreditLedgerEntry[]).filter((e) => e.kind === "release");
    expect(releases).toHaveLength(1); // NOT duplicated
  });

  it("#403 MAYOR-2: tras restituir TODO, el borrado sigue bloqueado — el ledger es evidencia de dinero", async () => {
    // cr-dest was fully released by the multi-origin test above; its ledger
    // (applications + releases) survives as money evidence: a signed fake
    // release can zero the accumulators, so the ledger itself must keep the
    // document alive.
    await expect(deleteDoc(doc(holder.db, "orders/cr-dest"))).rejects.toThrow();
  });
});
