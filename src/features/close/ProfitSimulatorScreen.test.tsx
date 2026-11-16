// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { ProfitSimulatorScreen } from "./ProfitSimulatorScreen";

// #459 — the SIMULATOR is a read-only what-if surface: the canonical 50/30/20
// engine, zero writes, zero authorization controls, always labeled as such.

const mocks = vi.hoisted(() => ({
  state: { orders: [], expenses: [], customers: [] },
  activeStore: { id: "s1", name: "Tienda", type: "inventory_tiered" },
  draftOwnerId: "u_owner",
  loadClosesForStore: vi.fn(async () => []),
}));
vi.mock("../../app/StoreProvider", () => ({ useStore: () => ({ ...mocks, stateStatus: "ready" }) }));
vi.mock("../../app/firebase/firestoreData", () => ({
  loadClosesForStore: mocks.loadClosesForStore,
}));

describe("ProfitSimulatorScreen (#459)", () => {
  beforeEach(() => {
    mocks.loadClosesForStore.mockClear().mockResolvedValue([]);
  });

  it("etiqueta permanente «Simulación, sin efectos» y SIN controles de autorizar/pagar", () => {
    render(<ToastProvider><ProfitSimulatorScreen /></ToastProvider>);
    expect(screen.getAllByText(/Simulación, sin efectos/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/No autoriza ni realiza pagos/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: /Autorizar/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pagar/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cerrar mes/i })).toBeNull();
  });

  it("monto hipotético $1,000 sobre utilidad $1,000 → $500/$300/$200 (motor canónico #128)", () => {
    render(<ToastProvider><ProfitSimulatorScreen /></ToastProvider>);
    fireEvent.change(screen.getByLabelText(/Resultado del periodo/i), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/Monto hipotético/i), { target: { value: "1000" } });
    expect(screen.getAllByText("$500.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("$300.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("$200.00").length).toBeGreaterThanOrEqual(1);
  });

  it("utilidad $1,000 con pérdida previa $400 → base $600; y autorizar $400 deja $200 remanente", () => {
    render(<ToastProvider><ProfitSimulatorScreen /></ToastProvider>);
    fireEvent.change(screen.getByLabelText(/Resultado del periodo/i), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/Pérdida acumulada/i), { target: { value: "400" } });
    fireEvent.change(screen.getByLabelText(/Monto hipotético/i), { target: { value: "400" } });
    expect(screen.getAllByText(/\$600\.00/).length).toBeGreaterThanOrEqual(1); // base tras pérdidas
    expect(screen.getAllByText(/\$200\.00/).length).toBeGreaterThanOrEqual(1); // remanente
  });

  it("Restablecer limpia las entradas", () => {
    render(<ToastProvider><ProfitSimulatorScreen /></ToastProvider>);
    const input = screen.getByLabelText(/Monto hipotético/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /Restablecer/i }));
    expect(input.value).toBe("");
  });
});
