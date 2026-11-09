// @vitest-environment jsdom
// #276 — the cart is MEMORY-first: a read-only-broken localStorage must lose
// only persistence, never the order being built (two adds still two lines;
// intermittent writes never revert quantities).
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCart } from "./useCart";
import type { CartLine } from "../../lib/cart";

const item = (productSlug: string, unitPrice: number): Omit<CartLine, "qty"> => ({
  productSlug,
  unitPrice,
  name: productSlug,
  sku: productSlug.toUpperCase(),
});

describe("useCart con localStorage roto (#276)", () => {
  let throwing = false;
  const originalSet = window.localStorage.setItem.bind(window.localStorage);

  beforeEach(() => {
    window.localStorage.clear();
    throwing = false;
    window.localStorage.setItem = ((...args: Parameters<typeof originalSet>) => {
      if (throwing) throw new DOMException("quota", "QuotaExceededError");
      return originalSet(...args);
    }) as typeof Storage.prototype.setItem;
  });

  it("escritura siempre rota: dos agregados siguen siendo DOS líneas en memoria", () => {
    throwing = true;
    const { result } = renderHook(() => useCart("olivia"));
    act(() => result.current.add(item("p1", 100)));
    act(() => result.current.add(item("p2", 200)));
    expect(result.current.lines).toHaveLength(2);
    act(() => result.current.setQty("p1", 3));
    expect(result.current.lines.find((l) => l.productSlug === "p1")?.qty).toBe(3);
  });

  it("escritura intermitente: lo ya capturado nunca se revierte en silencio", () => {
    const { result } = renderHook(() => useCart("olivia"));
    act(() => result.current.add(item("p1", 100))); // persiste
    throwing = true; // la cuota se agota a media sesión
    act(() => result.current.setQty("p1", 2));
    act(() => result.current.add(item("p2", 200)));
    expect(result.current.lines.find((l) => l.productSlug === "p1")?.qty).toBe(2);
    expect(result.current.lines).toHaveLength(2);
  });

  it("con storage sano persiste igual que antes (regresión)", () => {
    const { result } = renderHook(() => useCart("olivia"));
    act(() => result.current.add(item("p1", 100)));
    const { result: reloaded } = renderHook(() => useCart("olivia"));
    expect(reloaded.current.lines).toHaveLength(1);
  });
});
