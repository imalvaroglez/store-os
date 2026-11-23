// @vitest-environment jsdom
// #538 — the Estrategia draft survives exits and reloads: persisted per
// person, store and category; corrupt data never breaks the editor.
import { beforeEach, describe, expect, it } from "vitest";
import { clearStrategyDraft, loadStrategyDraft, saveStrategyDraft, strategyDraftKey, type StrategyTableDraft } from "./strategyDraft";

const draft: StrategyTableDraft = {
  limits: [{ min: 0, max: 500 }, { min: 500 }],
  prices: { t_retail: [140, 210] },
  dirty: true,
};

beforeEach(() => localStorage.clear());

describe("#538 borrador de Estrategia — persistencia aislada", () => {
  it("guarda y recupera por persona, tienda y categoría", () => {
    saveStrategyDraft("u1", "s1", "c1", draft, "base-1");
    const loaded = loadStrategyDraft("u1", "s1", "c1");
    expect(loaded?.draft).toEqual(draft);
    expect(loaded?.draftBase).toBe("base-1");
  });

  it("el aislamiento es real: otra persona, tienda o categoría no lo ve", () => {
    saveStrategyDraft("u1", "s1", "c1", draft, "base-1");
    expect(loadStrategyDraft("u2", "s1", "c1")).toBeNull();
    expect(loadStrategyDraft("u1", "s2", "c1")).toBeNull();
    expect(loadStrategyDraft("u1", "s1", "c2")).toBeNull();
    expect(strategyDraftKey("u1", "s1", "c1")).not.toBe(strategyDraftKey("u1", "s1", "c2"));
  });

  it("limpiar borra sólo esa combinación", () => {
    saveStrategyDraft("u1", "s1", "c1", draft, "b");
    saveStrategyDraft("u1", "s1", "c2", draft, "b");
    clearStrategyDraft("u1", "s1", "c1");
    expect(loadStrategyDraft("u1", "s1", "c1")).toBeNull();
    expect(loadStrategyDraft("u1", "s1", "c2")).not.toBeNull();
  });

  it("JSON corrupto o esquema desconocido se descarta en silencio", () => {
    localStorage.setItem(strategyDraftKey("u1", "s1", "c1"), "{no json");
    expect(loadStrategyDraft("u1", "s1", "c1")).toBeNull();
    localStorage.setItem(strategyDraftKey("u1", "s1", "c1"), JSON.stringify({ v: 99, draft: {} }));
    expect(loadStrategyDraft("u1", "s1", "c1")).toBeNull();
    localStorage.setItem(strategyDraftKey("u1", "s1", "c1"), JSON.stringify({ v: 1 }));
    expect(loadStrategyDraft("u1", "s1", "c1")).toBeNull();
  });

  it("un draft sin bandas no se restaura (editor muerto evitado)", () => {
    saveStrategyDraft("u1", "s1", "c1", { limits: [], prices: {}, dirty: true }, "b");
    expect(loadStrategyDraft("u1", "s1", "c1")).toBeNull();
  });
});
