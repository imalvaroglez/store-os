import { describe, expect, it } from "vitest";
import { groupOrderLines } from "./orderGrouping";

describe("groupOrderLines", () => {
  it("groups by first appearance, preserves each line and puts uncategorized last", () => {
    const lines = [
      { name: "Sin grupo" },
      { name: "Anillo 1", categorySnapshot: { id: "rings", name: "Anillos" } },
      { name: "Pulsera", categorySnapshot: { id: "bracelets", name: "Pulseras" } },
      { name: "Anillo 2", categorySnapshot: { id: "rings", name: "Anillos" } },
    ];
    const groups = groupOrderLines(lines);
    expect(groups.map((group) => group.name)).toEqual(["Anillos", "Pulseras", "Sin categoría"]);
    expect(groups[0].lines.map((line) => line.name)).toEqual(["Anillo 1", "Anillo 2"]);
    expect(groups[2].lines[0].name).toBe("Sin grupo");
  });
});
