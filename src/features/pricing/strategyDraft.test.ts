// @vitest-environment jsdom
// #538 — the Estrategia draft survives exits and reloads: persisted per
// person, store and category; corrupt data never breaks the editor.
import { beforeEach, describe, expect, it } from "vitest";
import { clearStrategyDraft, loadStrategyDraft, normalizeStrategyDraft, saveStrategyDraft, strategyDraftKey, type StrategyTableDraft } from "./strategyDraft";

const draft: StrategyTableDraft = {
  limits: [{ min: 0, max: 500 }, { min: 500 }],
  prices: { t_retail: [140, 210] },
  dirty: true,
};

const TIERS = ["t_retail"];

beforeEach(() => localStorage.clear());

describe("#538 borrador de Estrategia — persistencia aislada", () => {
  it("guarda y recupera por persona, tienda y categoría", () => {
    saveStrategyDraft("u1", "s1", "c1", draft, "base-1");
    const loaded = loadStrategyDraft("u1", "s1", "c1", TIERS);
    expect(loaded?.draft).toEqual(draft);
    expect(loaded?.draftBase).toBe("base-1");
  });

  it("el aislamiento es real: otra persona, tienda o categoría no lo ve", () => {
    saveStrategyDraft("u1", "s1", "c1", draft, "base-1");
    expect(loadStrategyDraft("u2", "s1", "c1", TIERS)).toBeNull();
    expect(loadStrategyDraft("u1", "s2", "c1", TIERS)).toBeNull();
    expect(loadStrategyDraft("u1", "s1", "c2", TIERS)).toBeNull();
    expect(strategyDraftKey("u1", "s1", "c1")).not.toBe(strategyDraftKey("u1", "s1", "c2"));
  });

  it("limpiar borra sólo esa combinación", () => {
    saveStrategyDraft("u1", "s1", "c1", draft, "b");
    saveStrategyDraft("u1", "s1", "c2", draft, "b");
    clearStrategyDraft("u1", "s1", "c1");
    expect(loadStrategyDraft("u1", "s1", "c1", TIERS)).toBeNull();
    expect(loadStrategyDraft("u1", "s1", "c2", TIERS)).not.toBeNull();
  });

  it("JSON corrupto o esquema desconocido se descarta en silencio", () => {
    localStorage.setItem(strategyDraftKey("u1", "s1", "c1"), "{no json");
    expect(loadStrategyDraft("u1", "s1", "c1", TIERS)).toBeNull();
    localStorage.setItem(strategyDraftKey("u1", "s1", "c1"), JSON.stringify({ v: 99, draft: {} }));
    expect(loadStrategyDraft("u1", "s1", "c1", TIERS)).toBeNull();
    localStorage.setItem(strategyDraftKey("u1", "s1", "c1"), JSON.stringify({ v: 1 }));
    expect(loadStrategyDraft("u1", "s1", "c1", TIERS)).toBeNull();
  });

  it("un draft sin bandas no se restaura (editor muerto evitado)", () => {
    saveStrategyDraft("u1", "s1", "c1", { limits: [], prices: {}, dirty: true }, "b");
    expect(loadStrategyDraft("u1", "s1", "c1", TIERS)).toBeNull();
  });

  it("límites insanos se descartan: mínimo no numérico, negativo o máximo menor que el mínimo", () => {
    expect(normalizeStrategyDraft({ limits: [{ min: "0", max: 500 }], prices: {} }, TIERS)).toBeNull();
    expect(normalizeStrategyDraft({ limits: [{ min: -1 }], prices: {} }, TIERS)).toBeNull();
    expect(normalizeStrategyDraft({ limits: [{ min: 500, max: 100 }], prices: {} }, TIERS)).toBeNull();
  });
});

// Dictamen QA de #538 (menor): el borrador guardado debe encajar con los
// niveles visibles AL recuperarlo, no con los de cuando se guardó.
describe("#538 borrador guardado frente a niveles que cambian después", () => {
  const limits = [{ min: 0, max: 500 }, { min: 500 }];

  it("un nivel desocultado después entra como precio pendiente (null), nunca como 0", () => {
    const normalized = normalizeStrategyDraft({ limits, prices: { t_retail: [140, 210] }, dirty: true }, ["t_retail", "t_girly"]);
    expect(normalized?.prices).toEqual({ t_retail: [140, 210], t_girly: [null, null] });
  });

  it("un nivel ocultado después sale del borrador (su regla guardada viaja intacta al guardar)", () => {
    const normalized = normalizeStrategyDraft({ limits, prices: { t_retail: [140, 210], t_girly: [120, 180] }, dirty: true }, ["t_retail"]);
    expect(Object.keys(normalized!.prices)).toEqual(["t_retail"]);
  });

  it("precios que no son números sanos quedan pendientes: texto, NaN, negativo o lista corta", () => {
    const normalized = normalizeStrategyDraft({ limits, prices: { t_retail: ["140", 210] }, dirty: true }, ["t_retail"]);
    expect(normalized?.prices.t_retail).toEqual([null, 210]);
    const short = normalizeStrategyDraft({ limits, prices: { t_retail: [140] }, dirty: true }, ["t_retail"]);
    expect(short?.prices.t_retail).toEqual([140, null]);
    const bad = normalizeStrategyDraft({ limits, prices: { t_retail: [NaN, -5] }, dirty: true }, ["t_retail"]);
    expect(bad?.prices.t_retail).toEqual([null, null]);
  });

  it("al recuperar se aplica la misma adaptación", () => {
    saveStrategyDraft("u1", "s1", "c1", { limits, prices: { t_retail: [140, 210], t_hidden: [1, 2] }, dirty: true }, "base");
    const loaded = loadStrategyDraft("u1", "s1", "c1", ["t_retail", "t_girly"]);
    expect(loaded?.draft.prices).toEqual({ t_retail: [140, 210], t_girly: [null, null] });
    expect(loaded?.draft.dirty).toBe(true);
  });
});
