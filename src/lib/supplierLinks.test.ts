import { describe, expect, it } from "vitest";
import { linkDocId, normalizeSupplierCode, suggestedProductFor } from "./supplierLinks";

// #211 fase 1: recordar la asociación CONFIRMADA entre el código del ticket
// de un proveedor exacto y un producto. Identidad = storeId + supplierId +
// código normalizado (el texto original se conserva); colisiones y códigos
// ambiguos se muestran para revisión, nunca auto-seleccionados.

describe("normalizeSupplierCode (#211)", () => {
  it("conserva el original y normaliza solo para buscar: espacios, caso y ceros/o", () => {
    expect(normalizeSupplierCode(" AR-0123 ")).toBe("ar0123");
    expect(normalizeSupplierCode("AR-O123")).toBe("ar0123"); // O→0 (tickets mal impresos)
    expect(normalizeSupplierCode("ar.i123")).toBe("ar1123"); // I→1
    expect(normalizeSupplierCode("BR-456")).toBe(normalizeSupplierCode("BR-456"));
  });

  it("no confunde B/V: son caracteres distintos tras normalizar", () => {
    expect(normalizeSupplierCode("VB-01")).not.toBe(normalizeSupplierCode("VV-01"));
  });
});

describe("linkDocId (#211)", () => {
  it("la identidad es tienda + proveedor + código normalizado", () => {
    expect(linkDocId("s1", "sup1", " AR-O123 ")).toBe("s1__sup1__ar0123");
    expect(linkDocId("s1", "sup2", "AR-0123")).not.toBe(linkDocId("s1", "sup1", "AR-0123")); // otro proveedor
    expect(linkDocId("s2", "sup1", "AR-0123")).not.toBe(linkDocId("s1", "sup1", "AR-0123")); // otra tienda
  });
});

describe("suggestedProductFor (#211)", () => {
  const link = (code: string, productId: string) => ({
    id: linkDocId("s1", "sup1", code), storeId: "s1", supplierId: "sup1",
    code, normalizedCode: normalizeSupplierCode(code), productId, productName: productId,
    confirmedAt: "2026-11-01T00:00:00.000Z", confirmedBy: "u1",
  });

  it("código con asociación ÚNICA confirmada sugiere ese producto", () => {
    const links = [link("AR-0123", "p_aro")];
    expect(suggestedProductFor(links, "s1", "sup1", "AR-O123")).toMatchObject({ productId: "p_aro" });
  });

  it("código sin asociación o proveedor/tienda distintos NO sugieren nada", () => {
    const links = [link("AR-0123", "p_aro")];
    expect(suggestedProductFor(links, "s1", "sup1", "OTRO-999")).toBeNull();
    expect(suggestedProductFor(links, "s1", "sup9", "AR-0123")).toBeNull(); // otro proveedor
    expect(suggestedProductFor(links, "s9", "sup1", "AR-0123")).toBeNull(); // otra tienda
  });

  it("asociaciones contradictorias sobre el mismo código NO adivinan: quedan para revisión", () => {
    const conflicting = [link("AR-0123", "p_aro"), { ...link("AR-0123", "p_otro"), id: "x2" }];
    expect(suggestedProductFor(conflicting, "s1", "sup1", "AR-0123")).toBeNull();
  });

  it("proveedor sin identificar (sin supplierId) nunca consulta asociaciones", () => {
    const links = [link("AR-0123", "p_aro")];
    expect(suggestedProductFor(links, "s1", undefined, "AR-0123")).toBeNull();
  });
});
