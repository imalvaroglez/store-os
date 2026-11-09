// @vitest-environment jsdom
// #255/#257 — the supplies form must never demand data it does not let Fer
// provide: simplified supplies need no units (#255), and reclassifying into a
// consumable supply must accept the units that create its stash (#257).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExpensesScreen } from "./ExpensesScreen";
import { ToastProvider } from "../../design-system";
import { fixtureState } from "../../lib/testFixtures";
import type { LooseExpense } from "../../types";

const mocks = vi.hoisted(() => ({
  state: null as ReturnType<typeof fixtureState> | null,
  saveExpense: vi.fn(),
}));

vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({
      state: mocks.state,
      activeStore: mocks.state?.stores.find((s) => s.id === mocks.state?.activeStoreId) ?? null,
      saveExpense: mocks.saveExpense,
      assignExpense: vi.fn(),
      consumeSupply: vi.fn(),
      deleteExpense: vi.fn(),
    }),
  };
});

function expense(partial: Partial<LooseExpense>): LooseExpense {
  return {
    id: "exp_1",
    storeId: "store_olivia",
    amount: 41.38,
    date: "2026-11-06",
    category: "operation",
    createdAt: "2026-11-06T12:00:00.000Z",
    updatedAt: "2026-11-06T12:00:00.000Z",
    ...partial,
  };
}

beforeEach(() => {
  mocks.state = fixtureState();
  mocks.saveExpense.mockReset();
  mocks.saveExpense.mockResolvedValue(undefined);
});

async function openCreate() {
  fireEvent.click(screen.getByRole("button", { name: "+ Agregar" }));
}

async function openEdit(index: number) {
  // Cards render in list order (single fixture per test → index 0).
  const buttons = screen.getAllByRole("button", { name: "Editar" });
  fireEvent.click(buttons[index]);
}

describe("#255 — suministros con tratamiento simplificado", () => {
  it("guarda sin exigir unidades cuando el campo está oculto por el tratamiento simplificado", async () => {
    render(<ToastProvider><ExpensesScreen /></ToastProvider>);
    await openCreate();
    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "supplies" } });
    fireEvent.click(screen.getByLabelText(/Tratamiento simplificado/));
    expect(screen.queryByLabelText(/Unidades compradas/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await screen.findByText("Gasto registrado.")).toBeTruthy();
    expect(mocks.saveExpense).toHaveBeenCalledTimes(1);
    const saved = mocks.saveExpense.mock.calls[0][0] as LooseExpense;
    expect(saved.category).toBe("supplies");
    expect(saved.simplifiedOperation).toBe(true);
    expect(saved.supply).toBeUndefined();
  });

  it("sigue exigiendo unidades para un suministro consumible sin simplificado (regresión)", async () => {
    render(<ToastProvider><ExpensesScreen /></ToastProvider>);
    await openCreate();
    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "supplies" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await screen.findByText(/Captura cuántas unidades compraste/)).toBeTruthy();
    expect(mocks.saveExpense).not.toHaveBeenCalled();
  });
});

describe("#257 — reclasificar a Suministros al editar", () => {
  it("permite capturar las unidades y crea el suministro una sola vez", async () => {
    mocks.state!.expenses.push(expense({ id: "exp_gift", description: "Bolsas para regalo", category: "sale_delivery" }));
    render(<ToastProvider><ExpensesScreen /></ToastProvider>);
    await openEdit(0);
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "supplies" } });
    const units = screen.getByLabelText(/Unidades compradas/) as HTMLInputElement;
    expect(units.disabled).toBe(false);
    fireEvent.change(units, { target: { value: "96" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await screen.findByText("Gasto actualizado.")).toBeTruthy();
    expect(mocks.saveExpense).toHaveBeenCalledTimes(1);
    const saved = mocks.saveExpense.mock.calls[0][0] as LooseExpense;
    expect(saved.id).toBe("exp_gift");
    expect(saved.category).toBe("supplies");
    expect(saved.supply).toEqual({ quantityInitial: 96, consumptions: [] });
    // La evidencia original se conserva.
    expect(saved.amount).toBe(41.38);
    expect(saved.date).toBe("2026-11-06");
  });

  it("mantiene intacto el stash de un suministro existente (unidades bloqueadas como evidencia)", async () => {
    const stash = { quantityInitial: 96, consumptions: [] };
    mocks.state!.expenses.push(expense({ id: "exp_sup", description: "Moñitos para paleta", category: "supplies", supply: stash }));
    render(<ToastProvider><ExpensesScreen /></ToastProvider>);
    await openEdit(0);
    const units = screen.getByLabelText(/Unidades compradas/) as HTMLInputElement;
    expect(units.disabled).toBe(true);
    expect(units.value).toBe("96");
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await screen.findByText("Gasto actualizado.")).toBeTruthy();
    const saved = mocks.saveExpense.mock.calls[0][0] as LooseExpense;
    expect(saved.supply).toEqual(stash);
  });

  it("acepta reclasificar a Suministros con tratamiento simplificado, sin stash ni unidades", async () => {
    mocks.state!.expenses.push(expense({ id: "exp_op", description: "Cinta de regalo", category: "operation" }));
    render(<ToastProvider><ExpensesScreen /></ToastProvider>);
    await openEdit(0);
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "supplies" } });
    fireEvent.click(screen.getByLabelText(/Tratamiento simplificado/));
    expect(screen.queryByLabelText(/Unidades compradas/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await screen.findByText("Gasto actualizado.")).toBeTruthy();
    const saved = mocks.saveExpense.mock.calls[0][0] as LooseExpense;
    expect(saved.category).toBe("supplies");
    expect(saved.simplifiedOperation).toBe(true);
    expect(saved.supply).toBeUndefined();
  });

  it("des-simplificar manda la clave en undefined para que el merge borre la bandera (hallazgo de revisión)", async () => {
    mocks.state!.expenses.push(expense({ id: "exp_sim", description: "Papel excedente", category: "supplies", simplifiedOperation: true }));
    render(<ToastProvider><ExpensesScreen /></ToastProvider>);
    await openEdit(0);
    const simplified = screen.getByLabelText(/Tratamiento simplificado/) as HTMLInputElement;
    expect(simplified.checked).toBe(true);
    fireEvent.click(simplified);
    // Al dejar de ser simplificado se vuelve un suministro consumible: exige unidades.
    const units = screen.getByLabelText(/Unidades compradas/) as HTMLInputElement;
    fireEvent.change(units, { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await screen.findByText("Gasto actualizado.")).toBeTruthy();
    const saved = mocks.saveExpense.mock.calls[0][0] as LooseExpense;
    // El contrato con saveEntity: la clave presente en undefined dispara deleteField.
    expect(Object.prototype.hasOwnProperty.call(saved, "simplifiedOperation")).toBe(true);
    expect(saved.simplifiedOperation).toBeUndefined();
    expect(saved.supply).toEqual({ quantityInitial: 50, consumptions: [] });
  });

  it("un gasto con asignaciones edita con controles bloqueados y sin exigir unidades (hallazgo adversarial C)", async () => {
    mocks.state!.expenses.push(expense({
      id: "exp_locked",
      description: "Gasolina del viaje",
      category: "operation",
      assignments: [{ id: "asg_1", at: "2026-11-06T12:00:00.000Z", by: "uid_fer", amountCents: 1000, target: { kind: "order", orderId: "order_olivia_1" } }] as LooseExpense["assignments"],
    }));
    render(<ToastProvider><ExpensesScreen /></ToastProvider>);
    await openEdit(0);
    const category = screen.getByLabelText(/Categoría/) as HTMLSelectElement;
    expect(category.disabled).toBe(true);
    expect(screen.getByText(/la clasificación queda fija/)).toBeTruthy();
    const simplified = screen.getByLabelText(/Tratamiento simplificado/) as HTMLInputElement;
    expect(simplified.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await screen.findByText("Gasto actualizado.")).toBeTruthy();
    const saved = mocks.saveExpense.mock.calls[0][0] as LooseExpense;
    expect(saved.category).toBe("operation");
    expect(saved.supply).toBeUndefined();
  });
});

describe("importes extremos (hallazgos adversariales A y B)", () => {
  it("el importe no admite tercer decimal: 0.001 se corta a 0.00 y se rechaza", async () => {
    render(<ToastProvider><ExpensesScreen /></ToastProvider>);
    await openCreate();
    const amount = screen.getByLabelText("Importe") as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "0.001" } });
    expect(amount.value).toBe("0.00");
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await screen.findByText(/Captura un importe mayor que cero/)).toBeTruthy();
    expect(mocks.saveExpense).not.toHaveBeenCalled();
  });

  it("rechaza importes gigantes antes de persistirlos (rompían el render por overflow de centavos)", async () => {
    render(<ToastProvider><ExpensesScreen /></ToastProvider>);
    await openCreate();
    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "99999999" } });
    fireEvent.change(screen.getByLabelText("Descripción (opcional)"), { target: { value: "prueba" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await screen.findByText(/demasiado grande/)).toBeTruthy();
    expect(mocks.saveExpense).not.toHaveBeenCalled();
  });
});
