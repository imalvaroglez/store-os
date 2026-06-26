import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Badge,
  Button,
  ProductImage,
  SelectField,
  Sheet,
} from "./index";
import { TONE_BADGE, ORDER_STATUS_TONE } from "./tokens";

describe("Badge", () => {
  it("renders children with the tone's badge classes", () => {
    const { container } = render(<Badge tone="success">Cobrado</Badge>);
    expect(screen.getByText("Cobrado")).toBeTruthy();
    expect(container.querySelector("span")?.className).toContain(TONE_BADGE.success);
  });
});

describe("Button", () => {
  it("fires onClick", () => {
    let clicked = false;
    render(<Button onClick={() => (clicked = true)}>Guardar</Button>);
    screen.getByText("Guardar").click();
    expect(clicked).toBe(true);
  });
});

describe("ProductImage", () => {
  it("shows an img when src provided", () => {
    const { container } = render(<ProductImage src="/x.png" alt="p" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/x.png");
  });
  it("shows placeholder emoji when no src", () => {
    const { container } = render(<ProductImage alt="p" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("🛍️");
  });
});

describe("SelectField", () => {
  it("renders options and calls onChange", () => {
    let v = "a";
    render(
      <SelectField
        label="Cat"
        value={v}
        onChange={(n) => (v = n)}
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
      />
    );
    const select = screen.getByDisplayValue("Alpha") as HTMLSelectElement;
    expect(select).toBeTruthy();
    select.value = "b";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(v).toBe("b");
  });
});

describe("Sheet", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <Sheet open={false} onClose={() => {}} title="T">
        body
      </Sheet>
    );
    expect(container.textContent).toBe("");
  });
  it("renders title + close button when open", () => {
    render(
      <Sheet open onClose={() => {}} title="Nuevo">
        body
      </Sheet>
    );
    expect(screen.getByText("Nuevo")).toBeTruthy();
    expect(screen.getByText("body")).toBeTruthy();
    expect(screen.getByLabelText("Cerrar")).toBeTruthy();
  });
});

describe("tokens", () => {
  it("every order status maps to a known tone", () => {
    const tones = Object.values(ORDER_STATUS_TONE);
    expect(tones.every((t) => t in TONE_BADGE)).toBe(true);
  });
});
