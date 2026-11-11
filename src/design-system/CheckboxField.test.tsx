// @vitest-environment jsdom
// #324 — a checkbox is its own label: one <label> per control, never nested.
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CheckboxField } from "./FormField";

describe("CheckboxField · labels sin anidar (#324)", () => {
  it("renderiza EXACTAMENTE un label — el clic en el texto alterna la casilla", () => {
    const onChange = vi.fn();
    const { container } = render(<CheckboxField label="Aretes" checked={false} onChange={onChange} />);
    // Un solo <label> en el componente (antes: FormField's label + el interno).
    expect(container.querySelectorAll("label")).toHaveLength(1);
    // El label está asociado al input: el clic en el TEXTO hace toggle.
    fireEvent.click(screen.getByText("Aretes"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("caption y hint viajan dentro del mismo label, sin romper la asociación", () => {
    const { container } = render(
      <CheckboxField label="Novedad" caption="aparece con distintivo" hint="solo visible" checked onChange={() => {}} />
    );
    expect(container.querySelectorAll("label")).toHaveLength(1);
    expect(screen.getByText("aparece con distintivo")).toBeTruthy();
    expect(screen.getByText("solo visible")).toBeTruthy();
  });

  it("disabled: el texto no dispara onChange", () => {
    const onChange = vi.fn();
    render(<CheckboxField label="Bloqueada" checked={false} disabled onChange={onChange} />);
    fireEvent.click(screen.getByText("Bloqueada"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
