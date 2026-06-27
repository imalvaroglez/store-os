# Multi-theme system — design (Store OS)

Date: 2026-06-26
Status: Approved (brainstorm)
Sub-project: A (frontend-only). Independent of the later Firebase/auth foundation.

## Context

Store OS has one visual identity today ("Cuenta Claros" paper-ledger). The owner
wants **multiple switchable themes**, each a full personality — not just color
swaps but typography, radii, shadows, and **motion**. Three directions, validated
visually in the brainstorm companion:

1. **Paper Ledger** (`paper`) — the current warm/quiet/editorial look. Default.
2. **Maximalist** (`maximalist`) — loud, high-contrast (acid yellow + black + hot
   red), heavy display sans, hard `0` radii, hard offset shadows, tilted cards,
   uppercase, punchy spring motion.
3. **Luxury** (`luxury`) — deep black + ivory + gold, fashion serif (Didot/Bodoni),
   tight radii, hairline gold borders, wide letter-spacing, slow graceful motion.

Themes are **per-user** (one theme everywhere, not per-store), switched via a
**picker in Settings**, persisted to `localStorage` now and to the user's Firestore
profile later. Pure frontend; no backend dependency. Ships before the Firebase
foundation because it's independent and delivers the maximalist look immediately.

## Decisions (brainstorm)

| Area | Decision |
|------|----------|
| Themes | Three: paper / maximalist / luxury. All ship. |
| Personality | Each theme owns color + type + radii + shadows + motion together. |
| Scope | Per-user (one theme everywhere), not per-store. |
| Switching | Picker in Settings/Opciones (no always-visible toggle). |
| Persistence | localStorage (`store_os_theme`) now → Firestore profile field when auth lands. |
| Sequencing | Spec'd first (this); Firebase foundation is a later sub-project. |

## Architecture

The design system is already token-driven (`tokens.ts`, Tailwind theme, CSS vars in
`index.css`, `.serif-display`). A theme = a different set of those token values.

### Theme shape (`src/design-system/theme/types.ts`)
```ts
type ThemeId = "paper" | "maximalist" | "luxury";
type Theme = {
  id: ThemeId;
  name: string;                       // UI label
  vars: Record<string, string>;       // CSS custom props (--paper, --ink, --terracotta, --gold, radii, shadows)
  fonts: { body: string; display: string };
  motion: {
    fast: string; base: string; slow: string;         // durations
    easeSpring: string; easeSmooth: string; easeLuxury: string;
    keyframes?: Record<string, string>;               // per-theme @keyframes (stamp, pop, ...)
  };
};
```

### Files
- `src/design-system/theme/types.ts` — `Theme`, `ThemeId`.
- `src/design-system/theme/{paper,maximalist,luxury}.ts` — the three definitions.
- `src/design-system/theme/ThemeProvider.tsx` — holds `themeId`, sets
  `data-theme` + injects `vars`/`fonts`/keyframes on `<html>`, exposes `useTheme()`.
- `src/design-system/theme/index.ts` — barrel.
- `src/design-system/theme/ThemePicker.tsx` — three labeled swatch cards (mini
  preview each), used inside the Settings Sheet.

### How primitives restyle
- Colors/radii/shadows: primitives already (or will be migrated to) read Tailwind
  classes mapped to CSS vars. The theme's `vars` override `:root[data-theme="…"]`.
- Motion: `Sheet` (slideUp), screen `riseIn`, `Button`/`Card` press read motion
  tokens (duration + easing) from CSS vars; each theme supplies its own keyframes
  (Paper = soft, Maximalist = stamp/pop + spring, Luxury = long luxury ease).
- Fonts: `fonts.body`/`fonts.display` set via vars; `.serif-display` and body
  font resolve per theme.

### Settings integration
Add a "Tema" section to the existing Settings/Opciones Sheet (`AppShell.tsx`):
renders `<ThemePicker />`. Applying a theme calls `setTheme(id)` → instant swap,
persisted.

### Persistence
`ThemeProvider` reads/writes `localStorage["store_os_theme"]` (default `paper`).
When auth lands, the read/write source swaps to the Firestore user profile; UI
unchanged.

## Verification
- `npm run typecheck` clean; `npm test` (gate + existing) green; `npm run build` green.
- New unit test: theme var injection (switching `themeId` writes the right `data-theme`
  + vars), and that all three themes export the full required token set (no missing vars).
- Playwright: open Settings, switch to each theme, assert `document.documentElement`
  has the right `data-theme` and a representative CSS var changed; screenshot each.
- Manual: confirm Paper Ledger is pixel-identical to today (regression guard).

## Out of scope
Backend, auth, roles, per-store themes, new product features, new runtime deps.
The Firebase foundation is a separate later sub-project.

## Known limitations
- Maximalist motion can be polarizing / accessibility-heavy; will respect
  `prefers-reduced-motion` (themes dampen motion when set).
- Theme picker lives in Settings for now; moves to the account area when auth lands.
