// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../../design-system";
import { ProfitDistributionScreen } from "./ProfitDistributionScreen";

// #128 etapa lista: la vista de reparto propuesto es una SIMULACIÓN de solo
// lectura — los tres casos de aceptación del contrato se leen en pantalla y
// el aviso de liquidez faltante siempre está (la fuente #279 aún no existe).

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("ProfitDistributionScreen (simulación de reparto)", () => {
  it("caso $1,000 de utilidad y $400 propuestos → $200/$120/$80 y $600 de remanente", () => {
    render(<ToastProvider><ProfitDistributionScreen /></ToastProvider>);
    fill("Resultado operativo del periodo", "1000");
    fill("Monto propuesto a repartir", "400");
    expect(screen.getByText("Fer (50%)").parentElement?.textContent).toContain("$200.00");
    expect(screen.getByText("Olivia (30%)").parentElement?.textContent).toContain("$120.00");
    expect(screen.getByText("Inversionista (20%)").parentElement?.textContent).toContain("$80.00");
    expect(screen.getByText("Remanente (queda en su periodo)").parentElement?.textContent).toContain("$600.00");
    expect(screen.getByText("Simulación")).toBeTruthy();
    expect(screen.getByText(/Falta la revisión de liquidez/)).toBeTruthy();
  });

  it("−$1,000 acumulados y +$3,000 de utilidad → base por resultados $2,000 con pérdida compensada", () => {
    render(<ToastProvider><ProfitDistributionScreen /></ToastProvider>);
    fill("Resultado operativo del periodo", "3000");
    fill("Pérdida acumulada anterior", "1000");
    fill("Monto propuesto a repartir", "3000");
    expect(screen.getByText(/Base por resultados/).parentElement?.textContent).toContain("$2,000.00");
    expect(screen.getByText(/compensada este periodo/).parentElement?.textContent).toContain("$1,000.00");
    expect(screen.getByText("Fer (50%)").parentElement?.textContent).toContain("$1,000.00");
  });

  it("$100.01 propuestos → $50.01/$30.00/$20.00 (centavos exactos)", () => {
    render(<ToastProvider><ProfitDistributionScreen /></ToastProvider>);
    fill("Resultado operativo del periodo", "1000");
    fill("Monto propuesto a repartir", "100.01");
    expect(screen.getByText("Fer (50%)").parentElement?.textContent).toContain("$50.01");
    expect(screen.getByText("Olivia (30%)").parentElement?.textContent).toContain("$30.00");
    expect(screen.getByText("Inversionista (20%)").parentElement?.textContent).toContain("$20.00");
  });

  it("pérdida operativa: nada distribuible y la pérdida acumulada crece visiblemente", () => {
    render(<ToastProvider><ProfitDistributionScreen /></ToastProvider>);
    fill("Resultado operativo del periodo", "-500");
    fill("Pérdida acumulada anterior", "1000");
    fill("Monto propuesto a repartir", "300");
    expect(screen.getByText("A repartir ahora").parentElement?.textContent).toContain("$0.00");
    expect(screen.getByText(/Pérdida acumulada tras el periodo/).parentElement?.textContent).toContain("$1,500.00");
  });
});
