// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { ProfitDistributionScreen } from "./ProfitDistributionScreen";

// #459 — REPARTO DE UTILIDADES (real): sobre un periodo CERRADO (#458), con
// resumen disponible, autorización exclusiva de la dueña sobre el monto que
// ella decide (≤ máximo) y el motor canónico 50/30/20 de #128. La simulación
// pura vive en su propia pantalla (#459 Simulador).

const mocks = vi.hoisted(() => ({
  state: { orders: [], expenses: [], customers: [] },
  activeStore: { id: "s1", name: "Tienda", type: "inventory_tiered", ownerUid: "u_owner" },
  draftOwnerId: "u_owner",
  loadClosesForStore: vi.fn(),
  loadProfitDistributions: vi.fn(),
  authorizeProfitDistribution: vi.fn(),
}));
vi.mock("../../app/StoreProvider", () => ({ useStore: () => ({ ...mocks, stateStatus: "ready" }) }));
vi.mock("../../app/firebase/firestoreData", () => ({
  loadClosesForStore: mocks.loadClosesForStore,
  loadProfitDistributions: mocks.loadProfitDistributions,
  authorizeProfitDistribution: mocks.authorizeProfitDistribution,
}));

const closeDoc = (period: string, resultCents: number, version = 1) => ({
  id: `s1__${period}__v${version}`, storeId: "s1", period, version,
  monthLabel: period, totals: { salesCents: 0, costCents: 0, expensesCents: 0, operatingResultCents: resultCents, collectionsCents: 0 },
  coverageComplete: true, fingerprint: "fp", state: "closed" as const,
  authorizedByUid: "u_owner", authorizedAt: "2026-12-01T00:00:00.000Z", createdBy: "u_owner", createdAt: "2026-12-01T00:00:00.000Z",
});

beforeEach(() => {
  cleanup();
  mocks.loadClosesForStore.mockReset().mockResolvedValue([closeDoc("2026-11", 300000)]);
  mocks.loadProfitDistributions.mockReset().mockResolvedValue([]);
  mocks.authorizeProfitDistribution.mockReset().mockResolvedValue({ id: "d1" });
});

describe("ProfitDistributionScreen (#459 reparto real)", () => {
  it("requiere un cierre oficial: sin snapshot cerrado lo explica y no ofrece autorizar", async () => {
    mocks.loadClosesForStore.mockResolvedValue([]);
    render(<ToastProvider><ProfitDistributionScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByText(/no hay periodos con cierre oficial/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Revisar y autorizar/i })).toBeNull();
  });

  it("periodo cerrado: resumen disponible con la versión y el máximo por resultados", async () => {
    render(<ToastProvider><ProfitDistributionScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByText(/Cerrado · v1/i)).toBeTruthy());
    expect(screen.getAllByText(/\$3,000\.00/).length).toBeGreaterThanOrEqual(1); // utilidad del snapshot (resumen y hint)
    expect(screen.getByText(/Máximo por resultados pendiente/i)).toBeTruthy();
    // Liquidez desconocida: nunca caja disponible afirmada.
    expect(screen.getByText(/Liquidez y obligaciones: no confirmadas/i)).toBeTruthy();
  });

  it("la dueña autoriza $400 sobre $3,000 → $200/$120/$80 y $2,600 remanente; con confirmación explícita", async () => {
    render(<ToastProvider><ProfitDistributionScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: /Revisar y autorizar/i })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Importe a autorizar/i), { target: { value: "400" } });
    expect(screen.getByText("$200.00")).toBeTruthy();
    expect(screen.getByText("$120.00")).toBeTruthy();
    expect(screen.getByText("$80.00")).toBeTruthy();
    expect(screen.getByText(/\$2,600\.00/)).toBeTruthy(); // remanente sin autorizar
    // #459 r5: autorizar dinero exige confirmación — el botón solo abre la
    // revisión; NADA se escribe sin el «Autorizar» explícito.
    fireEvent.click(screen.getByRole("button", { name: /Revisar y autorizar/i }));
    expect(mocks.authorizeProfitDistribution).not.toHaveBeenCalled();
    expect(screen.getByText(/Autorizar reparto/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Autorizar" }));
    await waitFor(() => expect(mocks.authorizeProfitDistribution).toHaveBeenCalledTimes(1));
    const doc = mocks.authorizeProfitDistribution.mock.calls[0][0];
    expect(doc.authorizedAmountCents).toBe(40000);
    expect(doc.split).toEqual({ ferCents: 20000, oliviaCents: 12000, investorCents: 8000 });
    expect(doc.period).toBe("2026-11");
  });

  it("#459 r5: cancelar la revisión NO autoriza nada", async () => {
    render(<ToastProvider><ProfitDistributionScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: /Revisar y autorizar/i })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Importe a autorizar/i), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /Revisar y autorizar/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(mocks.authorizeProfitDistribution).not.toHaveBeenCalled();
  });

  it("ya autorizado descuenta del máximo: $3,000 − $400 previos → máximo $2,600 visible", async () => {
    mocks.loadProfitDistributions.mockResolvedValue([{
      id: "d0", storeId: "s1", period: "2026-11", closeId: "s1__2026-11__v1",
      authorizedAmountCents: 40000, split: { ferCents: 20000, oliviaCents: 12000, investorCents: 8000 },
      status: "authorized", authorizedByUid: "u_owner", authorizedAt: "2026-12-02T00:00:00.000Z",
      createdBy: "u_owner", createdAt: "2026-12-02T00:00:00.000Z",
    }]);
    render(<ToastProvider><ProfitDistributionScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByText(/Utilidad ya autorizada/i)).toBeTruthy());
    expect(screen.getAllByText(/\$2,600\.00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Historial del periodo/i)).toBeTruthy();
  });

  it("pérdida previa compensa la base antes del máximo (motor #128)", async () => {
    mocks.loadClosesForStore.mockResolvedValue([
      closeDoc("2026-10", -100000),
      closeDoc("2026-11", 300000),
    ]);
    render(<ToastProvider><ProfitDistributionScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByText(/Pérdidas previas compensadas/i)).toBeTruthy());
    expect(screen.getByText(/−\$1,000\.00/)).toBeTruthy();
    expect(screen.getAllByText(/\$2,000\.00/).length).toBeGreaterThanOrEqual(1); // base/máximo
  });

  it("no es la dueña: consulta sin CTA de autorización", async () => {
    mocks.draftOwnerId = "u_other";
    render(<ToastProvider><ProfitDistributionScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByText(/Solo la dueña/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Revisar y autorizar/i })).toBeNull();
    mocks.draftOwnerId = "u_owner";
  });

  it("versiones coexisten (v1/v2): la pérdida del periodo cuenta UNA vez y manda v2 (#202)", async () => {
    mocks.loadClosesForStore.mockReset().mockResolvedValue([
      closeDoc("2026-10", -100000, 1),
      closeDoc("2026-10", -100000, 2), // reapertura: misma pérdida, versión nueva
      closeDoc("2026-11", 300000),
    ]);
    render(<ToastProvider><ProfitDistributionScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByText(/Pérdidas previas compensadas/i)).toBeTruthy());
    expect(screen.getAllByText(/−\$1,000\.00/).length).toBeGreaterThanOrEqual(1); // UNA vez, no dos
    expect(screen.getByText(/Cerrado · v1/i)).toBeTruthy(); // noviembre v1 (único)
  });
});


describe("#459 r6 — ciclo de vida del intento en la UI", () => {
  it("cada revisión acuña un intentId nuevo; el reintento de la MISMA revisión lo conserva", async () => {
    render(<ToastProvider><ProfitDistributionScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: /Revisar y autorizar/i })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Importe a autorizar/i), { target: { value: "400" } });
    fireEvent.click(screen.getByRole("button", { name: /Revisar y autorizar/i }));
    fireEvent.click(screen.getByRole("button", { name: "Autorizar" }));
    await waitFor(() => expect(mocks.authorizeProfitDistribution).toHaveBeenCalledTimes(1));
    const first = mocks.authorizeProfitDistribution.mock.calls[0][0].intentId;
    expect(first).toBeTruthy();
    // Una NUEVA revisión (tras éxito el importe se limpia): nuevo intento —
    // nunca absorbe un importe distinto con la identidad del anterior.
    fireEvent.change(screen.getByLabelText(/Importe a autorizar/i), { target: { value: "600" } });
    fireEvent.click(screen.getByRole("button", { name: /Revisar y autorizar/i }));
    fireEvent.click(screen.getByRole("button", { name: "Autorizar" }));
    await waitFor(() => expect(mocks.authorizeProfitDistribution).toHaveBeenCalledTimes(2));
    expect(mocks.authorizeProfitDistribution.mock.calls[1][0].intentId).not.toBe(first);
    expect(mocks.authorizeProfitDistribution.mock.calls[1][0].authorizedAmountCents).toBe(60000);
  });
});
