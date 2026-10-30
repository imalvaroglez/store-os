// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InlineEditable, InlineFaqEditor } from "./InlineEditable";

describe("InlineEditable", () => {
  it("opens a design-system field and updates the parent draft", () => {
    const onChange = vi.fn();
    render(<InlineEditable enabled label="Historia" value="" placeholder="Toca para añadir" multiline render={(value) => <p>{value}</p>} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Editar Historia" }));
    const field = screen.getByLabelText("Historia");
    fireEvent.change(field, { target: { value: "La historia de la tienda" } });

    expect(onChange).toHaveBeenCalledWith("La historia de la tienda");
  });
});

describe("InlineFaqEditor", () => {
  it("adds, edits and removes questions in the draft", () => {
    const onChange = vi.fn();
    const value = [{ q: "¿Dónde entregan?", a: "En Guadalajara." }];
    render(<InlineFaqEditor enabled value={value} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Agregar pregunta" }));
    expect(onChange).toHaveBeenCalledWith([...value, { q: "", a: "" }]);
    fireEvent.click(screen.getByRole("button", { name: "Quitar pregunta" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
