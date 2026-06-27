import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { ThemeProvider, useTheme, THEMES } from "./ThemeProvider";
import { paper } from "./paper";
import { maximalist } from "./maximalist";
import { luxury } from "./luxury";

// The set of CSS vars every theme MUST define so primitives never read an empty var.
const REQUIRED_VARS = [
  "--paper", "--paper-2", "--ink", "--ink-soft", "--rule",
  "--terracotta", "--terracotta-soft", "--forest", "--forest-soft",
  "--rose", "--rose-soft", "--surface", "--surface-muted",
  "--radius-sm", "--radius-md", "--radius-lg", "--radius-sheet",
  "--shadow-card", "--shadow-lift",
];

describe("theme definitions", () => {
  it("exports exactly paper / maximalist / luxury", () => {
    expect(THEMES.map((t) => t.id).sort()).toEqual(["luxury", "maximalist", "paper"]);
  });

  it("every theme defines all required CSS vars", () => {
    for (const t of [paper, maximalist, luxury]) {
      for (const v of REQUIRED_VARS) {
        expect(t.vars[v], `${t.id} missing ${v}`).toBeDefined();
      }
    }
  });

  it("every theme defines fonts + motion", () => {
    for (const t of [paper, maximalist, luxury]) {
      expect(t.fonts.body).toBeTruthy();
      expect(t.fonts.display).toBeTruthy();
      expect(t.motion.fast).toBeTruthy();
      expect(t.motion.easeSmooth).toBeTruthy();
      // keyframes used by the app must exist in every theme.
      for (const kf of ["slideUp", "fadeIn", "riseIn"]) {
        expect(t.motion.keyframes?.[kf], `${t.id} missing ${kf} keyframe`).toBeTruthy();
      }
    }
  });

  it("maximalist ships its signature stamp keyframe", () => {
    expect(maximalist.motion.keyframes?.stamp).toBeTruthy();
  });

  it("themes are visually distinct (different paper + ink)", () => {
    const papers = [paper, maximalist, luxury].map((t) => t.vars["--paper"]);
    const inks = [paper, maximalist, luxury].map((t) => t.vars["--ink"]);
    expect(new Set(papers).size).toBe(3);
    expect(new Set(inks).size).toBe(3);
  });
});

describe("ThemeProvider", () => {
  it("sets data-theme and a representative CSS var on <html>", async () => {
    function Probe() {
      const { setTheme } = useTheme();
      return (
        <button onClick={() => setTheme("maximalist")}>go</button>
      );
    }
    const { getByText } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    // default = paper
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("paper");
    });
    expect(document.documentElement.style.getPropertyValue("--paper")).toBe(paper.vars["--paper"]);

    getByText("go").click();
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("maximalist");
    });
    expect(document.documentElement.style.getPropertyValue("--paper")).toBe(maximalist.vars["--paper"]);
    // motion vars injected too
    expect(document.documentElement.style.getPropertyValue("--motion-base")).toBe(
      maximalist.motion.base
    );
  });

  it("injects the theme keyframes into a <style id=theme-keyframes>", async () => {
    function Probe() {
      const { setTheme } = useTheme();
      return <button onClick={() => setTheme("luxury")}>go</button>;
    }
    const { getByText } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    getByText("go").click();
    await waitFor(() => {
      expect(document.getElementById("theme-keyframes")?.textContent).toContain("@keyframes slideUp");
    });
  });
});
