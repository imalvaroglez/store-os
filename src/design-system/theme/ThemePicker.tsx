import { useTheme } from "./ThemeProvider";
import type { Theme } from "./types";

// A mini live preview of a theme, rendered by injecting that theme's vars onto a
// scoped wrapper (so all three previews show simultaneously without affecting the app).
function ThemePreview({ theme }: { theme: Theme }) {
  const style = {
    "--paper": theme.vars["--paper"],
    "--paper-2": theme.vars["--paper-2"],
    "--ink": theme.vars["--ink"],
    "--ink-soft": theme.vars["--ink-soft"],
    "--rule": theme.vars["--rule"],
    "--terracotta": theme.vars["--terracotta"],
    "--forest": theme.vars["--forest"],
    "--shadow-card": theme.vars["--shadow-card"],
    "--radius-md": theme.vars["--radius-md"],
    "--radius-lg": theme.vars["--radius-lg"],
    "--card-tilt": theme.vars["--card-tilt"] ?? "0deg",
    "--label-tracking": theme.vars["--label-tracking"] ?? "0.08em",
    fontFamily: theme.fonts.body,
    "--font-display": theme.fonts.display,
  } as React.CSSProperties;

  return (
    <div
      style={style}
      className="rounded-[var(--radius-md)] p-3 border border-rule/60"
      // scoped bg so the preview shows the theme's paper color
    >
      <div
        className="rounded-[var(--radius-md)] p-3 shadow-card"
        style={{
          background: theme.vars["--surface"],
          transform: `rotate(var(--card-tilt))`,
        }}
      >
        <div
          className="text-[8px] uppercase font-bold text-ink-soft"
          style={{ letterSpacing: "var(--label-tracking)" }}
        >
          Ganancia
        </div>
        <div
          className="serif-display text-lg font-semibold"
          style={{ color: theme.vars["--forest"] }}
        >
          $2,400
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className="text-[9px] font-bold text-white px-1.5 py-0.5"
            style={{
              background: theme.vars["--ink"],
              borderRadius: theme.vars["--radius-sm"],
            }}
          >
            +
          </span>
          <span className="text-[9px] font-semibold text-ink">Nuevo</span>
        </div>
      </div>
    </div>
  );
}

export function ThemePicker() {
  const { themes, themeId, setTheme } = useTheme();
  return (
    <div className="grid grid-cols-3 gap-2">
      {themes.map((t) => {
        const active = t.id === themeId;
        return (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={`text-left rounded-xl p-1.5 transition-all ${
              active ? "ring-2 ring-ink" : "ring-1 ring-rule/60"
            }`}
            style={{ background: "transparent" }}
          >
            <ThemePreview theme={t} />
            <div className="mt-1.5 px-0.5">
              <div className="text-xs font-bold text-ink">{t.name}</div>
              <div className="text-[10px] text-ink-soft leading-tight">{t.blurb}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
