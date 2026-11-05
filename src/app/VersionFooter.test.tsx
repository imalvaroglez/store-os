// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VersionFooter } from "./VersionFooter";
import { LATEST_RELEASE, RELEASES } from "../releases/notes";

beforeEach(() => localStorage.clear());

describe("VersionFooter (#179)", () => {
  it("muestra la versión y fecha del build con el formato exacto", () => {
    render(<VersionFooter />);
    expect(screen.getByRole("button", { name: /Versión .*: ver notas/ })).toBeTruthy();
    expect(
      screen.getByText(`${LATEST_RELEASE.version} (${LATEST_RELEASE.date})`)
    ).toBeTruthy();
    // Formato MAJOR.MINOR.PATCH (YYYY.MM.DD) exigido por la issue.
    expect(`${LATEST_RELEASE.version} (${LATEST_RELEASE.date})`).toMatch(
      /^\d+\.\d+\.\d+ \(\d{4}\.\d{2}\.\d{2}\)$/
    );
  });

  it("abre las notas dentro de la app y se pueden cerrar", () => {
    render(<VersionFooter />);
    fireEvent.click(screen.getByRole("button", { name: /ver notas de versión/i }));
    expect(screen.getByText("Notas de versión")).toBeTruthy();
    expect(screen.getByText(LATEST_RELEASE.title)).toBeTruthy();
    for (const note of LATEST_RELEASE.notes) expect(screen.getByText(note)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByText("Notas de versión")).toBeNull();
  });

  it("el historial versionado cumple el contrato del guard (semver, fechas, notas)", () => {
    // Espejo local de scripts/check-release.cjs: si esto falla, la liberación
    // correspondiente también fallará en CI — mejor enterarse aquí.
    const semver = /^\d+\.\d+\.\d+$/;
    for (const release of RELEASES) {
      expect(release.version, `versión ${release.version}`).toMatch(semver);
      expect(release.date, `fecha de ${release.version}`).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
      expect(release.notes.length, `notas de ${release.version}`).toBeGreaterThan(0);
      expect(release.title.trim().length).toBeGreaterThan(0);
    }
    for (let i = 1; i < RELEASES.length; i++) {
      const [a, b] = [RELEASES[i - 1].version, RELEASES[i].version].map((v) =>
        v.split(".").map(Number)
      );
      expect(
        (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]),
        `${RELEASES[i - 1].version} debe ser mayor que ${RELEASES[i].version}`
      ).toBeGreaterThan(0);
    }
  });
});
