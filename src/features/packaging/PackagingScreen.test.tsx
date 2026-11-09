// @vitest-environment jsdom
// #253 — Empaques config screen: materials + per-level profiles persist via
// updateStore, and invalid drafts never leave the browser.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PackagingScreen } from "./PackagingScreen";
import { ToastProvider } from "../../design-system";
import { fixtureState } from "../../lib/testFixtures";
import type { Store } from "../../types";

const mocks = vi.hoisted(() => ({
  state: null as ReturnType<typeof fixtureState> | null,
  savePackaging: vi.fn(),
}));

vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({
      state: mocks.state,
      activeStore: mocks.state?.stores.find((s) => s.id === mocks.state?.activeStoreId) ?? null,
      savePackaging: mocks.savePackaging,
    }),
  };
});

function olivia(): Store {
  const store = { ...mocks.state!.stores[0] };
  store.priceTiers = [
    { id: "t_iconic", label: "Iconic", order: 1 },
    { id: "t_retail", label: "Regular", order: 2 },
  ];
  store.defaultTierId = "t_iconic";
  return store;
}

beforeEach(() => {
  mocks.state = fixtureState();
  mocks.savePackaging.mockReset();
  mocks.savePackaging.mockResolvedValue(undefined);
});

describe("PackagingScreen (#253)", () => {
  it("agrega un material con costo y lo vincula a un suministro", async () => {
    mocks.state!.stores[0] = olivia();
    render(<ToastProvider><PackagingScreen /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Bolsa transparente" } });
    fireEvent.change(screen.getByLabelText(/Costo estimado por unidad/), { target: { value: "0.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.getByText("Bolsa transparente")).toBeTruthy();
    expect(screen.getByText(/0\.5/)).toBeTruthy();
  });

  it("guarda el perfil por nivel: material por pieza y por pedido", async () => {
    mocks.state!.stores[0] = olivia();
    render(<ToastProvider><PackagingScreen /></ToastProvider>);
    // Material primero
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Moño" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    // Perfil del nivel Iconic (primer tier por orden)
    fireEvent.click(screen.getAllByRole("button", { name: "+ Material por pieza" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "+ Material por pedido" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Guardar empaques" }));
    await screen.findByText("Empaques guardados.");
    expect(mocks.savePackaging).toHaveBeenCalledTimes(1);
    const saved = mocks.savePackaging.mock.calls[0][0] as { materials: unknown[]; byTier: Record<string, unknown> };
    expect(saved.materials).toHaveLength(1);
    expect(saved.byTier["t_iconic"]).toEqual({
      perPiece: [{ materialId: expect.any(String), units: 1 }],
      perOrder: [{ materialId: expect.any(String), units: 1 }],
    });
  });

  it("rechaza guardar con unidades inválidas (0) y no llama a updateStore", async () => {
    mocks.state!.stores[0] = olivia();
    render(<ToastProvider><PackagingScreen /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Bolsa" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    fireEvent.click(screen.getAllByRole("button", { name: "+ Material por pieza" })[0]);
    const units = screen.getByLabelText(/Unidades/) as HTMLInputElement;
    fireEvent.change(units, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar empaques" }));
    expect(await screen.findByText(/enteras y al menos 1/)).toBeTruthy();
    expect(mocks.savePackaging).not.toHaveBeenCalled();
  });

  it("no elimina un material referenciado por un perfil", async () => {
    mocks.state!.stores[0] = {
      ...olivia(),
      packaging: {
        materials: [{ id: "m1", name: "Bolsa", estimatedCost: 0.5 }],
        byTier: { t_iconic: { perPiece: [{ materialId: "m1", units: 1 }], perOrder: [] } },
      },
    };
    render(<ToastProvider><PackagingScreen /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(await screen.findByText(/usado en perfiles/)).toBeTruthy();
    expect(screen.getAllByText("Bolsa").length).toBeGreaterThan(0);
  });

  it("el costo estimado no admite tercer decimal (0.001 → 0.00)", () => {
    mocks.state!.stores[0] = olivia();
    render(<ToastProvider><PackagingScreen /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar" }));
    const cost = screen.getByLabelText(/Costo estimado por unidad/) as HTMLInputElement;
    fireEvent.change(cost, { target: { value: "0.001" } });
    expect(cost.value).toBe("0.00");
  });
});
