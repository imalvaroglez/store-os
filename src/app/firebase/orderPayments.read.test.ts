import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ parent: vi.fn(), receipts: vi.fn() }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: {} }) }));
vi.mock("firebase/firestore", async (importOriginal) => ({
  ...await importOriginal<typeof import("firebase/firestore")>(),
  doc: vi.fn(() => ({})), collection: vi.fn(() => ({})),
  getDocFromServer: api.parent, getDocsFromServer: api.receipts,
}));
import { fetchOrderPayments } from "./firestoreData";

const parent = (paymentsRevision: number) => ({ exists: () => true, data: () => ({ storeId: "s1", items: [], deposit: 0, paymentsRevision, paymentsReceivedCents: 40000 }) });
beforeEach(() => { api.parent.mockReset(); api.receipts.mockReset().mockResolvedValue({ docs: [] }); });
describe("consistent receipt history", () => {
  it("returns details only when the receipt version stays unchanged across their server read", async () => {
    api.parent.mockResolvedValue(parent(2));
    api.receipts.mockResolvedValue({ docs: ["p1", "p2"].map((id) => ({ id, data: () => ({ orderId: "o1", storeId: "s1", amount: 200, createdAt: "2026-11-03" }) })) });
    const result = await fetchOrderPayments("o1");
    expect(result.order).toMatchObject({ id: "o1", paymentsRevision: 2, paymentsReceivedCents: 40000 });
    expect(result.payments).toHaveLength(2);
  });
  it("rejects an interleaved payment instead of presenting incomplete details as current", async () => {
    api.parent.mockResolvedValueOnce(parent(1)).mockResolvedValueOnce(parent(2));
    await expect(fetchOrderPayments("o1")).rejects.toThrow(/cambiaron mientras se cargaban/);
  });
  it("propagates a server failure rather than using cached success", async () => {
    api.parent.mockRejectedValue(new Error("Sin conexión"));
    await expect(fetchOrderPayments("o1")).rejects.toThrow("Sin conexión");
    expect(api.receipts).not.toHaveBeenCalled();
  });
});
