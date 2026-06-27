import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Theme, ThemeId } from "./types";
import { paper } from "./paper";
import { maximalist } from "./maximalist";
import { luxury } from "./luxury";

export const THEMES: Theme[] = [paper, maximalist, luxury];
const BY_ID: Record<ThemeId, Theme> = {
  paper,
  maximalist,
  luxury,
};

const STORAGE_KEY = "store_os_theme";

type ThemeContextValue = {
  theme: Theme;
  themeId: ThemeId;
  themes: Theme[];
  setTheme: (id: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function initialThemeId(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    if (saved && saved in BY_ID) return saved;
  } catch {
    /* ignore */
  }
  return "paper";
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(initialThemeId);
  const theme = BY_ID[themeId];

  // Inject the active theme onto <html>: data-theme, CSS vars, font + motion vars,
  // and the theme's @keyframes. Reduced-motion users get a flat motion override.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme.id);

    // CSS custom props.
    for (const [k, v] of Object.entries(theme.vars)) {
      root.style.setProperty(k, v);
    }
    // Fonts + motion as vars so primitives can read them.
    root.style.setProperty("--font-body", theme.fonts.body);
    root.style.setProperty("--font-display", theme.fonts.display);
    root.style.setProperty("--motion-fast", theme.motion.fast);
    root.style.setProperty("--motion-base", theme.motion.base);
    root.style.setProperty("--motion-slow", theme.motion.slow);
    root.style.setProperty("--ease-smooth", theme.motion.easeSmooth);
    root.style.setProperty("--ease-spring", theme.motion.easeSpring);
    root.style.setProperty("--ease-luxury", theme.motion.easeLuxury);

    // Keyframes: a single <style id="theme-keyframes"> we replace each switch.
    const existing = document.getElementById("theme-keyframes");
    if (existing) existing.remove();
    const style = document.createElement("style");
    style.id = "theme-keyframes";
    let css = "";
    for (const [name, body] of Object.entries(theme.motion.keyframes ?? {})) {
      css += `@keyframes ${name} { ${body} }`;
    }
    // Reduced-motion: dampen everything to near-instant, no transform jumps.
    if (prefersReducedMotion()) {
      css += `*, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }`;
    }
    style.textContent = css;
    document.head.appendChild(style);
  }, [theme]);

  // Persist choice.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, themeId);
    } catch {
      /* ignore */
    }
  }, [themeId]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, themeId, themes: THEMES, setTheme: setThemeId }),
    [theme, themeId]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
