import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  AnimatedNumber,
  Badge,
  Button,
  ProductImage,
  Reveal,
  SelectField,
  Sheet,
  Skeleton,
  SkeletonCard,
  ToastProvider,
  useToast,
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

describe("Toast", () => {
  it("renders a toast when success() is called", () => {
    function Trigger() {
      const toast = useToast();
      return <button onClick={() => toast.success("Guardado")}>go</button>;
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    expect(screen.queryByText("Guardado")).toBeNull();
    fireEvent.click(screen.getByText("go"));
    expect(screen.getByText("Guardado")).toBeTruthy();
  });
});

describe("Skeleton", () => {
  it("Skeleton renders an element with aria-busy", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toBeTruthy();
    expect((container.firstChild as HTMLElement).getAttribute("aria-busy")).toBe("true");
  });
  it("SkeletonCard renders image + text placeholders", () => {
    const { container } = render(<SkeletonCard />);
    expect(container.querySelectorAll("[aria-busy='true']").length).toBeGreaterThanOrEqual(3);
  });
});

describe("AnimatedNumber", () => {
  it("renders the final value formatted as currency", () => {
    // jsdom has no IntersectionObserver; the component falls back to showing
    // the target value immediately when IO is unavailable.
    const { container } = render(<AnimatedNumber value={18420} format="currency" />);
    expect(container.textContent).toContain("$18,420");
  });
  it("renders plain integer when no format", () => {
    const { container } = render(<AnimatedNumber value={1234} />);
    expect(container.textContent).toContain("1,234");
  });
});

describe("Reveal", () => {
  it("renders children (jsdom has no IO; falls back to visible)", () => {
    const { container } = render(
      <Reveal><span>hi</span></Reveal>
    );
    expect(container.textContent).toContain("hi");
  });
});
