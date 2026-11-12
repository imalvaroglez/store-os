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
});
