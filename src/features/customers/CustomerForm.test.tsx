// @vitest-environment jsdom
// #219 — Contrato de captura del flujo Clientas: teléfono con separadores y
// validación de dígitos, Instagram sin espacios, nombre con aviso suave de
// duplicado (acentos/caso insensible), y persistencia limpia.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CustomerForm, sanitizePhoneInput } from "./CustomerForm";
import { ToastProvider } from "../../design-system";
import { fixtureState } from "../../lib/testFixtures";
import type { Customer } from "../../types";

const mocks = vi.hoisted(() => ({
  state: null as ReturnType<typeof fixtureState> | null,
  upsertCustomer: vi.fn(),
}));

vi.mock("../../app/StoreProvider", () => ({
  useStore: () => ({
    state: mocks.state,
    activeStore: mocks.state?.stores.find((st) => st.id === "store_olivia") ?? null,
    upsertCustomer: mocks.upsertCustomer,
  }),
}));

const blank: Customer = {
  id: "new_1",
  storeId: "store_olivia",
  name: "",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

function fill(fields: { name?: string; phone?: string; instagram?: string }) {
  if (fields.name !== undefined) fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: fields.name } });
  if (fields.phone !== undefined) fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: fields.phone } });
  if (fields.instagram !== undefined) fireEvent.change(screen.getByLabelText("Instagram"), { target: { value: fields.instagram } });
}

beforeEach(() => {
  const state = fixtureState();
  state.customers = [];
  mocks.state = state;
  mocks.upsertCustomer.mockReset().mockResolvedValue(undefined);
});

describe("#219 Clientas · teléfono", () => {
  it("sanitizePhoneInput conserva lo que Fer pega de WhatsApp y rechaza lo demás", () => {
    expect(sanitizePhoneInput("+52 55-1234 (5678)")).toBe("+52 55-1234 (5678)");
    expect(sanitizePhoneInput("5512345678abc😀")).toBe("5512345678");
    expect(sanitizePhoneInput("")).toBe("");
  });

  it("menos de 8 dígitos no guarda y explica la lada", async () => {
    render(<ToastProvider><CustomerForm customer={{ ...blank }} onDone={() => {}} /></ToastProvider>);
    fill({ name: "María", phone: "55 1234" });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cliente" }));
    expect(await screen.findByText(/al menos 8 dígitos/)).toBeTruthy();
    expect(mocks.upsertCustomer).not.toHaveBeenCalled();
  });

  it("teléfono con separadores válidos persiste tal cual (la búsqueda normaliza)", async () => {
    render(<ToastProvider><CustomerForm customer={{ ...blank }} onDone={() => {}} /></ToastProvider>);
    fill({ name: "María", phone: "+52 55-1234 5678" });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cliente" }));
    await waitFor(() => expect(mocks.upsertCustomer).toHaveBeenCalledTimes(1));
    expect((mocks.upsertCustomer.mock.calls[0][0] as Customer).phone).toBe("+52 55-1234 5678");
  });
});

describe("#219 Clientas · Instagram", () => {
  it("espacios jamás entran al draft; el guardado limpia extremos", async () => {
    render(<ToastProvider><CustomerForm customer={{ ...blank }} onDone={() => {}} /></ToastProvider>);
    fill({ name: "María", instagram: " @maria.joyas " });
    const input = screen.getByLabelText("Instagram") as HTMLInputElement;
    expect(input.value).toBe("@maria.joyas");
    fireEvent.click(screen.getByRole("button", { name: "Guardar cliente" }));
    await waitFor(() => expect(mocks.upsertCustomer).toHaveBeenCalledTimes(1));
    expect((mocks.upsertCustomer.mock.calls[0][0] as Customer).instagram).toBe("@maria.joyas");
  });
});

describe("#219 Clientas · nombre duplicado (aviso suave, nunca bloqueo)", () => {
  it("Maria Lopez avisa contra María López (acentos/caso) y se puede guardar de todos modos", async () => {
    mocks.state!.customers = [{ ...blank, id: "c_1", name: "María López" } as Customer];
    render(<ToastProvider><CustomerForm customer={{ ...blank }} onDone={() => {}} /></ToastProvider>);
    fill({ name: "Maria Lopez" });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cliente" }));
    expect(await screen.findByText(/Ya existe «María López»/)).toBeTruthy();
    expect(mocks.upsertCustomer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Guardar de todos modos" }));
    await waitFor(() => expect(mocks.upsertCustomer).toHaveBeenCalledTimes(1));
  });

  it("nombres distintos no avisan", async () => {
    mocks.state!.customers = [{ ...blank, id: "c_1", name: "Ana Torres" } as Customer];
    render(<ToastProvider><CustomerForm customer={{ ...blank }} onDone={() => {}} /></ToastProvider>);
    fill({ name: "María López" });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cliente" }));
    await waitFor(() => expect(mocks.upsertCustomer).toHaveBeenCalledTimes(1));
  });
});

describe("#304 hallazgos de revisión", () => {
  beforeEach(() => {
    const state = fixtureState();
    state.customers = [];
    mocks.state = state;
    mocks.upsertCustomer.mockReset().mockResolvedValue(undefined);
  });

  it("H1: teclear el teléfono carácter a carácter CONSERVA los espacios interiores", () => {
    render(<ToastProvider><CustomerForm customer={{ ...blank }} onDone={() => {}} /></ToastProvider>);
    const phone = screen.getByLabelText("Teléfono") as HTMLInputElement;
    // Simula tecleo real: cada tecla dispara change con el valor acumulado.
    for (const keystroke of ["5", "5", " ", "1", "2", "3", "4", " ", "5", "6", "7", "8"]) {
      fireEvent.change(phone, { target: { value: phone.value + keystroke } });
    }
    expect(phone.value).toBe("55 1234 5678"); // el espacio interior sobrevive
  });

  it("H1: pegar con letras/emojis se limpia pero los separadores quedan", () => {
    render(<ToastProvider><CustomerForm customer={{ ...blank }} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "+52 (55) 1234-5678😀jaja" } });
    expect((screen.getByLabelText("Teléfono") as HTMLInputElement).value).toBe("+52 (55) 1234-5678");
  });

  it("auto-exclusión: editar a la MISMA clienta nunca avisa contra sí misma", async () => {
    mocks.state!.customers = [{ ...blank, id: "c_me", name: "María López" } as Customer];
    render(<ToastProvider><CustomerForm customer={{ ...blank, id: "c_me", name: "María Lopez" } as Customer} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "María López" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cliente" }));
    await waitFor(() => expect(mocks.upsertCustomer).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Ya existe/)).toBeNull();
  });
});
