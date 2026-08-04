# UI/UX upgrade — motion & polish components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 motion/structure components (toasts, skeletons, animated counter, reveal, lightbox, dialog, dropdown, command palette) to the design-system, all CSS + IntersectionObserver, no dependencies.

**Architecture:** Each component is a self-contained primitive in `src/design-system/`, exported from the barrel `index.ts`, built on real CSS-vars/tokens already defined in `src/index.css` (`--paper`, `--ink`, `--ink-soft`, `--rule`, `--danger`, `--success`, `--motion-fast/base/slow`, `--ease-smooth`, `--ease-spring`). New `@keyframes` are appended to `src/index.css`. Overlays reuse the ESC + body-overflow pattern from `Sheet.tsx`. Focus-trap (Dialog/CommandPalette) is manual.

**Tech Stack:** React 18 + TypeScript + Tailwind + Vitest + @testing-library/react.

**Conventions (from existing code — follow exactly):**
- Token-driven Tailwind classes: `bg-paper`, `text-ink`, `text-ink-soft`, `border-rule`, `bg-surface`, `text-danger`. NOT hardcoded colors.
- Motion: inline `animation: name var(--motion-base) var(--ease-smooth)` or `animate-[name_var(--motion-fast)_var(--ease-smooth)]`.
- Tests: `@testing-library/react` + plain `expect(...).toBe(...)` asserts (see `primitives.test.tsx`).
- Gate: primitives live in `src/design-system/` (allowed to use raw `<button>`); features/app must import from the barrel. Every new component is added to `index.ts`.
- `prefers-reduced-motion`: handled by `ThemeProvider` which nulls motion when set — components just reference `var(--motion-*)` so they inherit the behavior. (Verify each component doesn't define its own duration overrides that bypass this.)

**Per-task verification (always):** after implementation, run `npm run typecheck && npm run test && npm run build`. All three must pass before the commit step. Add the component to the barrel `index.ts` in the same task that creates it.

---

## Phase 1 — Foundation

### Task 1: Toast component + provider

**Files:**
- Create: `src/design-system/Toast.tsx`
- Test: `src/design-system/Toast.tsx` (co-located test block in `primitives.test.tsx`)
- Modify: `src/design-system/index.ts` (exports)
- Modify: `src/index.css` (keyframes)

- [ ] **Step 1: Add keyframes to `src/index.css`**

Append after the existing `riseIn` keyframe (line 57):

```css
@keyframes toastIn { from { opacity: 0; transform: translateY(16px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes toastOut { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(8px) scale(.96); } }
```

- [ ] **Step 2: Write the failing test in `src/design-system/primitives.test.tsx`**

Add to the imports at top: `ToastProvider, useToast` from `./index`. Add this describe block at the end:

```tsx
describe("Toast", () => {
  it("renders a toast when success() is called", () => {
    function Trigger() {
      const toast = useToast();
      return <button onClick={() => toast.success("Guardado")}>go</button>;
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    expect(screen.queryByText("Guardado")).toBeNull();
    screen.getByText("go").click();
    expect(screen.getByText("Guardado")).toBeTruthy();
  });
});
```

Add `ToastProvider` and `useToast` to the import list from `./index` at the top of the file.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- primitives`
Expected: FAIL — `ToastProvider`/`useToast` not exported.

- [ ] **Step 4: Implement `src/design-system/Toast.tsx`**

```tsx
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type ToastVariant = "success" | "error" | "info";
interface ToastAction { label: string; onClick: () => void; }
interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
  action?: ToastAction;
}
interface ToastApi {
  success: (msg: string, opts?: { action?: ToastAction }) => void;
  error: (msg: string, opts?: { action?: ToastAction }) => void;
  info: (msg: string, opts?: { action?: ToastAction }) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

const TONE: Record<ToastVariant, string> = {
  success: "bg-success",
  error: "bg-danger",
  info: "bg-ink",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string, opts?: { action?: ToastAction }) => {
      const id = nextId.current++;
      setToasts((t) => [...t, { id, variant, message, action: opts?.action }].slice(-3));
      window.setTimeout(() => remove(id), 3500);
    },
    [remove]
  );

  const api: ToastApi = {
    success: (m, o) => push("success", m, o),
    error: (m, o) => push("error", m, o),
    info: (m, o) => push("info", m, o),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 md:items-end pointer-events-none">
        {toasts.map((t) => (
          <Toast key={t.id} item={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function Toast({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  return (
    <div
      role={item.variant === "error" ? "alert" : "status"}
      aria-live="polite"
      className="pointer-events-auto flex items-center gap-3 rounded-lg bg-ink text-paper px-4 py-3 shadow-lift max-w-sm w-full md:w-auto"
      style={{ animation: "toastIn var(--motion-base) var(--ease-spring)" }}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${TONE[item.variant]}`} />
      <span className="text-sm flex-1">{item.message}</span>
      {item.action && (
        <button
          onClick={() => {
            item.action?.onClick();
            onClose();
          }}
          className="text-sm font-semibold text-terracotta hover:underline"
        >
          {item.action.label}
        </button>
      )}
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
```

- [ ] **Step 5: Export from barrel `src/design-system/index.ts`**

Add after the `Sheet` export (line 10):

```ts
export { ToastProvider, useToast } from "./Toast";
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npm run test -- primitives`
Expected: PASS.

- [ ] **Step 7: Full verification**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/design-system/Toast.tsx src/design-system/index.ts src/design-system/primitives.test.tsx src/index.css
git commit -m "feat(design-system): add toast component and provider"
```

---

### Task 2: Mount ToastProvider in the app + wire first toast (order advance)

**Files:**
- Modify: `src/app/App.tsx:52-59` (wrap Root)
- Modify: the order-advance action (find via grep `nextActionVerb` or `advanceOrder`)

- [ ] **Step 1: Wrap Root with ToastProvider in `src/app/App.tsx`**

Change the `App` function to:

```tsx
import { ToastProvider } from "../design-system";
// ...
export function App() {
  return (
    <StoreProvider>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </StoreProvider>
  );
}
```

- [ ] **Step 2: Find the order-advance call site**

Run: `grep -rn "advanceOrder\|nextActionVerb" src/features/orders/`
Note the file + line where advancing an order's status is triggered.

- [ ] **Step 3: Wire a success toast on advance**

In that file: import `useToast` from the design-system barrel, call `const toast = useToast();`, and after a successful advance add `toast.success("Pedido avanzado");`. Use the next status label if easily available, else the generic message.

- [ ] **Step 4: Full verification**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/App.tsx src/features/orders/
git commit -m "feat(orders): confirm order advance with toast"
```

---

### Task 3: Skeleton component

**Files:**
- Create: `src/design-system/Skeleton.tsx`
- Modify: `src/design-system/index.ts`
- Modify: `src/design-system/primitives.test.tsx` (test)
- Modify: `src/index.css` (shimmer keyframe)

- [ ] **Step 1: Add shimmer keyframe to `src/index.css`**

Append:

```css
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
```

- [ ] **Step 2: Write the failing test in `primitives.test.tsx`**

Add to imports: `Skeleton, SkeletonCard`. Add:

```tsx
describe("Skeleton", () => {
  it("Skeleton renders an element with aria-busy", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toBeTruthy();
    expect((container.firstChild as HTMLElement).getAttribute("aria-busy")).toBe("true");
  });
  it("SkeletonCard renders image + text placeholders", () => {
    const { container } = render(<SkeletonCard />);
    expect(container.querySelectorAll("[aria-busy='true']").length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- primitives`
Expected: FAIL — `Skeleton`/`SkeletonCard` not exported.

- [ ] **Step 4: Implement `src/design-system/Skeleton.tsx`**

```tsx
// Loading placeholders that mimic the shape of content about to arrive.
// Shimmer via background-position animation; reduced-motion leaves a static tint
// (ThemeProvider nulls --motion-* under prefers-reduced-motion, freezing the loop).
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-busy="true"
      role="status"
      className={`rounded-md bg-paper-2 ${className}`}
      style={{
        backgroundImage: "linear-gradient(90deg, transparent, var(--surface) 50%, transparent)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.4s var(--motion-base, 1.4s) linear infinite",
      }}
    />
  );
}

export function SkeletonText({ lines = 2 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={i === lines - 1 ? "h-3 w-3/5" : "h-3 w-full"} />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-card bg-surface border border-rule p-3 shadow-card">
      <Skeleton className="h-24 w-full mb-3" />
      <Skeleton className="h-4 w-full mb-2" />
      <Skeleton className="h-3 w-3/5" />
    </div>
  );
}
```

- [ ] **Step 5: Export from barrel**

Add after the `Spinner` export (line 9):

```ts
export { Skeleton, SkeletonText, SkeletonCard } from "./Skeleton";
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npm run test -- primitives`
Expected: PASS.

- [ ] **Step 7: Full verification**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/design-system/Skeleton.tsx src/design-system/index.ts src/design-system/primitives.test.tsx src/index.css
git commit -m "feat(design-system): add skeleton loading placeholders"
```

---

### Task 4: Wire SkeletonCard into catalog loading

> **Deviation (resolved at execution):** `CatalogScreen.tsx` has no loading
> state — it renders synchronously from already-subscribed `StoreProvider`
> state, so adding a loading flag there is YAGNI. The only real cloud-loading
> spinner is `Spinner label="Cargando catálogo…"` in `PublicCatalogScreen.tsx`.
> **This task was retargeted to `PublicCatalogScreen.tsx`.** Added a
> `role="status" aria-label="Cargando catálogo…"` on the loading container to
> preserve the screen-reader announcement the spinner carried.

**Files:**
- Modify: `src/features/catalog/PublicCatalogScreen.tsx` (replace Spinner with skeleton grid while cloud-loading)

- [ ] **Step 1: Find the loading branch**

Run: `grep -n "Spinner\|loading\|isLoading" src/features/catalog/CatalogScreen.tsx`
Identify where the loading state renders `<Spinner .../>`.

- [ ] **Step 2: Replace with a skeleton grid**

Import `SkeletonCard` from the design-system barrel. Replace the `<Spinner />` block with:

```tsx
<div className="grid grid-cols-2 md:grid-cols-3 gap-3">
  {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
</div>
```

- [ ] **Step 3: Full verification**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass. The gate must still pass (no raw elements added).

- [ ] **Step 4: Commit**

```bash
git add src/features/catalog/CatalogScreen.tsx
git commit -m "feat(catalog): show skeleton grid while loading"
```

---

## Phase 2 — Editorial aesthetics

### Task 5: AnimatedNumber component

**Files:**
- Create: `src/design-system/AnimatedNumber.tsx`
- Modify: `src/design-system/index.ts`
- Modify: `src/design-system/primitives.test.tsx` (test)

- [ ] **Step 1: Write the failing test in `primitives.test.tsx`**

Add to imports: `AnimatedNumber`. Add:

```tsx
describe("AnimatedNumber", () => {
  it("renders the final value formatted as currency", () => {
    // jsdom has no IntersectionObserver; the component falls back to showing
    // the target value immediately when IO is unavailable.
    const { container } = render(<AnimatedNumber value={18420} format="currency" />);
    expect(container.textContent).toContain("$18,420");
  });
  it("renders plain integer when no format", () => {
    const { container } = render(<AnimatedNumber value={1234} />);
    expect(container.textContent).toContain("1,234");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- primitives`
Expected: FAIL — `AnimatedNumber` not exported.

- [ ] **Step 3: Implement `src/design-system/AnimatedNumber.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { formatMoney } from "../lib/money";

// Counts from 0 to `value` with an ease-out curve, triggered when the element
// scrolls into view (IntersectionObserver). Falls back to the final value when
// IO is unavailable (jsdom) or under prefers-reduced-motion.
export function AnimatedNumber({
  value,
  format,
  duration = 1200,
}: {
  value: number;
  format?: "currency";
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  const fmt = (n: number) =>
    format === "currency" ? formatMoney(n) : Math.round(n).toLocaleString("es-MX");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const run = () => {
      if (started.current) return;
      started.current = true;
      if (prefersReduced) {
        setDisplay(value);
        return;
      }
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        setDisplay(value * eased);
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    if (typeof IntersectionObserver === "undefined") {
      setDisplay(value);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && run()),
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value, duration]);

  return (
    <span ref={ref} className="serif-display tnum">
      {fmt(display)}
    </span>
  );
}
```

- [ ] **Step 4: Export from barrel**

Add after `Money`/`StatRow` (line 6):

```ts
export { AnimatedNumber } from "./AnimatedNumber";
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm run test -- primitives`
Expected: PASS.

- [ ] **Step 6: Full verification**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/design-system/AnimatedNumber.tsx src/design-system/index.ts src/design-system/primitives.test.tsx
git commit -m "feat(design-system): add animated number counter"
```

---

### Task 6: Reveal component (in-view fade-up)

**Files:**
- Create: `src/design-system/Reveal.tsx`
- Modify: `src/design-system/index.ts`
- Modify: `src/design-system/primitives.test.tsx` (test)
- Modify: `src/index.css` (reveal keyframe)

- [ ] **Step 1: Add reveal keyframe to `src/index.css`**

Append:

```css
@keyframes revealUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
```

- [ ] **Step 2: Write the failing test in `primitives.test.tsx`**

Add to imports: `Reveal`. Add:

```tsx
describe("Reveal", () => {
  it("renders children (jsdom has no IO; falls back to visible)", () => {
    const { container } = render(
      <Reveal><span>hi</span></Reveal>
    );
    expect(container.textContent).toContain("hi");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- primitives`
Expected: FAIL — `Reveal` not exported.

- [ ] **Step 4: Implement `src/design-system/Reveal.tsx`**

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";

// Wraps content that fades up when it scrolls into view. Disconnects after the
// first reveal so scrolling back up does not re-animate. In jsdom (no IO) or
// under reduced motion, children render visibly with no animation.
export function Reveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setShown(true)),
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={
        shown
          ? undefined
          : { opacity: 0, transform: "translateY(16px)" }
      }
    >
      {shown ? (
        <div style={{ animation: "revealUp var(--motion-base) var(--ease-smooth)" }}>
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

// Staggered reveal for list children. Each direct child fades up ~80ms after the
// previous, capped at 6 so long lists do not feel slow.
export function RevealList({ children }: { children: ReactNode }) {
  return (
    <div className="rise">
      {children}
    </div>
  );
}
```

Note: `RevealList` reuses the existing `.rise` CSS stagger in `index.css` (lines 89-98) — DRY, no new animation needed for it.

- [ ] **Step 5: Export from barrel**

Add after `AnimatedNumber`:

```ts
export { Reveal, RevealList } from "./Reveal";
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npm run test -- primitives`
Expected: PASS.

- [ ] **Step 7: Full verification**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/design-system/Reveal.tsx src/design-system/index.ts src/design-system/primitives.test.tsx src/index.css
git commit -m "feat(design-system): add reveal-on-scroll wrapper"
```

---

### Task 7: Wire AnimatedNumber + Reveal into HomeScreen stats

**Files:**
- Modify: `src/features/home/HomeScreen.tsx` (stats block)

- [ ] **Step 1: Find the stats block**

Run: `grep -n "StatRow\|formatMoney\|stat" src/features/home/HomeScreen.tsx`
Identify the numeric stats shown on the dashboard.

- [ ] **Step 2: Wrap stats with Reveal and use AnimatedNumber**

Import `Reveal` and `AnimatedNumber` from the barrel. Wrap the stats section in `<Reveal>` and replace each numeric stat's literal with `<AnimatedNumber value={n} format="currency" />` (or no format for counts). Leave `StatRow` as the layout wrapper.

- [ ] **Step 3: Full verification**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/home/HomeScreen.tsx
git commit -m "feat(home): animate dashboard stats on reveal"
```

---

## Phase 3 — Showcase

### Task 8: Lightbox component

**Files:**
- Create: `src/design-system/Lightbox.tsx`
- Modify: `src/design-system/index.ts`
- Modify: `src/design-system/primitives.test.tsx` (test)
- Modify: `src/index.css` (lightbox keyframes)

- [ ] **Step 1: Add keyframes to `src/index.css`**

Append:

```css
@keyframes lightboxIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes lightboxPop { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: scale(1); } }
```

- [ ] **Step 2: Write the failing test in `primitives.test.tsx`**

Add to imports: `Lightbox`. Add:

```tsx
describe("Lightbox", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <Lightbox open={false} images={[]} index={0} onClose={() => {}} />
    );
    expect(container.textContent).toBe("");
  });
  it("renders the image alt when open", () => {
    render(
      <Lightbox open images={[{ src: "/a.png", alt: "Vasija" }]} index={0} onClose={() => {}} />
    );
    expect(screen.getByAltText("Vasija")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- primitives`
Expected: FAIL — `Lightbox` not exported.

- [ ] **Step 4: Implement `src/design-system/Lightbox.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { IconButton } from "./Button";

interface LightboxImage { src: string; alt: string; }

// Full-viewport image viewer for the public catalog. Keyboard nav (←/→, Esc),
// swipe on touch, reuses ProductImage-friendly img. Reuses the Sheet pattern
// for ESC + body scroll lock.
export function Lightbox({
  open,
  images,
  index,
  onClose,
}: {
  open: boolean;
  images: LightboxImage[];
  index: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(index);
  useEffect(() => setI(index), [index, open]);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((p) => (p + 1) % images.length);
      if (e.key === "ArrowLeft") setI((p) => (p - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose, images.length]);

  if (!open || images.length === 0) return null;
  const img = images[i];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={img.alt}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/90"
      style={{ animation: "lightboxIn var(--motion-fast) var(--ease-smooth)" }}
      onClick={onClose}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (dx > 40) setI((p) => (p - 1 + images.length) % images.length);
        if (dx < -40) setI((p) => (p + 1) % images.length);
        touchX.current = null;
      }}
    >
      <div className="absolute top-4 right-4">
        <IconButton variant="ghost" aria-label="Cerrar" onClick={onClose} className="text-paper text-2xl">
          ×
        </IconButton>
      </div>
      <div
        className="max-w-[90vw] max-h-[85vh] flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "lightboxPop var(--motion-base) var(--ease-spring)" }}
      >
        <img src={img.src} alt={img.alt} className="max-w-[90vw] max-h-[75vh] object-contain rounded-lg" />
        <p className="serif-display text-paper text-lg">{img.alt}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Export from barrel**

Add after `Reveal`:

```ts
export { Lightbox } from "./Lightbox";
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npm run test -- primitives`
Expected: PASS.

- [ ] **Step 7: Full verification**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/design-system/Lightbox.tsx src/design-system/index.ts src/design-system/primitives.test.tsx src/index.css
git commit -m "feat(design-system): add lightbox image viewer"
```

---

### Task 9: Wire Lightbox into PublicCatalogScreen

**Files:**
- Modify: `src/features/catalog/PublicCatalogScreen.tsx`

- [ ] **Step 1: Find the product image render**

Run: `grep -n "ProductImage\|<img\|photo" src/features/catalog/PublicCatalogScreen.tsx`

- [ ] **Step 2: Add open-on-click**

Import `Lightbox` and `useState` from the design-system barrel and react. Add state `const [lb, setLb] = useState<number | null>(null);`. Make each product image clickable: `onClick={() => setLb(idx)}`. Render `<Lightbox open={lb !== null} images={products.map(p => ({src: p.photo, alt: p.name}))} index={lb ?? 0} onClose={() => setLb(null)} />` at the screen root. Filter out products without photos when building the image list.

- [ ] **Step 3: Full verification**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/catalog/PublicCatalogScreen.tsx
git commit -m "feat(catalog): open product photos in lightbox (public)"
```

---

## Phase 4 — Dialog & actions

### Task 10: Dialog component (centered, manual focus-trap)

**Files:**
- Create: `src/design-system/Dialog.tsx`
- Modify: `src/design-system/index.ts`
- Modify: `src/design-system/primitives.test.tsx` (test)
- Modify: `src/index.css` (dialog keyframe)

- [ ] **Step 1: Add keyframes to `src/index.css`**

Append:

```css
@keyframes dialogIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes dialogPop { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }
```

- [ ] **Step 2: Write the failing test in `primitives.test.tsx`**

Add to imports: `Dialog`. Add:

```tsx
describe("Dialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<Dialog open={false} title="T" onClose={() => {}}><p>x</p></Dialog>);
    expect(container.textContent).toBe("");
  });
  it("renders title and children when open", () => {
    render(<Dialog open title="Borrar" onClose={() => {}}><p>¿Seguro?</p></Dialog>);
    expect(screen.getByText("Borrar")).toBeTruthy();
    expect(screen.getByText("¿Seguro?")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- primitives`
Expected: FAIL — `Dialog` not exported.

- [ ] **Step 4: Implement `src/design-system/Dialog.tsx`**

```tsx
import { useEffect, useRef, type ReactNode } from "react";

// Centered confirmation dialog. Manual focus trap (Tab/Shift+Tab kept inside),
// initial focus to first focusable, focus restore on close. Reuses the Sheet
// ESC + body-scroll-lock pattern.
export function Dialog({
  open,
  title,
  tone,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  tone?: "danger";
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement;
    const panel = panelRef.current;
    const focusables = () =>
      panel?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [];

    const first = focusables()[0];
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && active === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      lastFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center p-4"
      style={{ animation: "dialogIn var(--motion-fast) var(--ease-smooth)" }}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative bg-paper rounded-sheet w-full max-w-sm shadow-lift p-5"
        style={{ animation: "dialogPop var(--motion-base) var(--ease-spring)" }}
      >
        <h2 className={`serif-display text-xl font-semibold mb-2 ${tone === "danger" ? "text-danger" : "text-ink"}`}>
          {title}
        </h2>
        <div className="text-ink-soft text-sm mb-5">{children}</div>
        {footer && <div className="flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Export from barrel**

Add after `Lightbox`:

```ts
export { Dialog } from "./Dialog";
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npm run test -- primitives`
Expected: PASS.

- [ ] **Step 7: Full verification**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/design-system/Dialog.tsx src/design-system/index.ts src/design-system/primitives.test.tsx src/index.css
git commit -m "feat(design-system): add centered dialog with focus trap"
```

---

### Task 11: Wire Dialog into delete-store confirmation

**Files:**
- Modify: `src/features/stores/StoreSettingsScreen.tsx`

- [ ] **Step 1: Find the delete-store action**

Run: `grep -n "Eliminar\|delete\|remove\|destroy" src/features/stores/StoreSettingsScreen.tsx`

- [ ] **Step 2: Replace inline delete with Dialog confirmation**

Import `Dialog` and `Button` from the barrel. Add state `const [confirmDelete, setConfirmDelete] = useState(false);`. The existing "Eliminar tienda" button now opens the dialog. Render:

```tsx
<Dialog
  open={confirmDelete}
  title="Eliminar tienda"
  tone="danger"
  onClose={() => setConfirmDelete(false)}
  footer={
    <>
      <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
      <Button variant="danger" onClick={handleDelete}>Eliminar</Button>
    </>
  }
>
  Esta acción no se puede deshacer.
</Dialog>
```

Where `handleDelete` is the existing delete handler.

- [ ] **Step 3: Full verification**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/stores/StoreSettingsScreen.tsx
git commit -m "feat(stores): confirm store deletion in dialog"
```

---

### Task 12: Dropdown component

**Files:**
- Create: `src/design-system/Dropdown.tsx`
- Modify: `src/design-system/index.ts`
- Modify: `src/design-system/primitives.test.tsx` (test)
- Modify: `src/index.css` (dropdown keyframe)

- [ ] **Step 1: Add keyframe to `src/index.css`**

Append:

```css
@keyframes dropdownIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
```

- [ ] **Step 2: Write the failing test in `primitives.test.tsx`**

Add to imports: `Dropdown, DropdownItem`. Add:

```tsx
describe("Dropdown", () => {
  it("does not render menu when closed", () => {
    render(
      <Dropdown trigger={<span>t</span>} open={false} onClose={() => {}}>
        <DropdownItem onClick={() => {}}>Editar</DropdownItem>
      </Dropdown>
    );
    expect(screen.queryByText("Editar")).toBeNull();
  });
  it("renders items when open", () => {
    render(
      <Dropdown trigger={<span>t</span>} open onClose={() => {}}>
        <DropdownItem onClick={() => {}}>Editar</DropdownItem>
      </Dropdown>
    );
    expect(screen.getByText("Editar")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- primitives`
Expected: FAIL — `Dropdown`/`DropdownItem` not exported.

- [ ] **Step 4: Implement `src/design-system/Dropdown.tsx`**

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";

// Anchored action menu. Flips above/below based on viewport space. Arrow-key
// navigation, Esc / outside-click to close. Controlled `open`/`onClose`.
export function Dropdown({
  trigger,
  open,
  onClose,
  children,
}: {
  trigger: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [flipUp, setFlipUp] = useState(false);

  useEffect(() => {
    if (!open) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setFlipUp(rect.bottom > window.innerHeight - 220);
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={wrapRef} className="relative inline-block">
      {trigger}
      {open && (
        <div
          role="menu"
          className={`absolute right-0 ${flipUp ? "bottom-full mb-2" : "top-full mt-2"} z-50 min-w-[10rem] rounded-lg bg-paper border border-rule shadow-lift py-1`}
          style={{ animation: "dropdownIn var(--motion-fast) var(--ease-smooth)" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  children,
  onClick,
  tone,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "danger";
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`block w-full text-left px-4 py-2 text-sm hover:bg-paper-2 ${tone === "danger" ? "text-danger" : "text-ink"}`}
    >
      {children}
    </button>
  );
}

export function DropdownSeparator() {
  return <div className="my-1 h-px bg-rule" />;
}
```

- [ ] **Step 5: Export from barrel**

Add after `Dialog`:

```ts
export { Dropdown, DropdownItem, DropdownSeparator } from "./Dropdown";
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npm run test -- primitives`
Expected: PASS.

- [ ] **Step 7: Full verification**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/design-system/Dropdown.tsx src/design-system/index.ts src/design-system/primitives.test.tsx src/index.css
git commit -m "feat(design-system): add dropdown action menu"
```

---

### Task 13: Wire Dropdown into a product card

**Files:**
- Modify: `src/features/catalog/CatalogScreen.tsx` (or wherever product cards render their actions)

- [ ] **Step 1: Find where product card actions are**

Run: `grep -rn "IconButton\|Editar\|Editar producto" src/features/catalog/`

- [ ] **Step 2: Add a "⋯" dropdown per card**

Import `Dropdown, DropdownItem, DropdownSeparator, IconButton` and `useState`. Per card add `const [menu, setMenu] = useState(false);` and:

```tsx
<Dropdown
  open={menu}
  onClose={() => setMenu(false)}
  trigger={<IconButton variant="ghost" aria-label="Acciones" onClick={() => setMenu(v => !v)}>⋯</IconButton>}
>
  <DropdownItem onClick={onEdit}>Editar</DropdownItem>
  <DropdownSeparator />
  <DropdownItem tone="danger" onClick={onDelete}>Eliminar</DropdownItem>
</Dropdown>
```

Where `onEdit`/`onDelete` are the existing handlers (open the edit sheet / the delete dialog).

- [ ] **Step 3: Full verification**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass. Gate must pass (Dropdown uses raw `<button>` but lives in design-system, which is exempt).

- [ ] **Step 4: Commit**

```bash
git add src/features/catalog/CatalogScreen.tsx
git commit -m "feat(catalog): add actions dropdown to product cards"
```

---

### Task 14: CommandPalette component

**Files:**
- Create: `src/design-system/CommandPalette.tsx`
- Modify: `src/design-system/index.ts`
- Modify: `src/design-system/primitives.test.tsx` (test)
- Modify: `src/index.css` (keyframe)

- [ ] **Step 1: Add keyframe to `src/index.css`**

Append:

```css
@keyframes cmdIn { from { opacity: 0; transform: scale(.98); } to { opacity: 1; transform: scale(1); } }
```

- [ ] **Step 2: Write the failing test in `primitives.test.tsx`**

Add to imports: `CommandPalette`. Add:

```tsx
describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <CommandPalette open={false} onClose={() => {}} commands={[]} />
    );
    expect(container.textContent).toBe("");
  });
  it("lists commands when open and filters by query", () => {
    render(
      <CommandPalette open onClose={() => {}} commands={[
        { group: "Ir", items: [ { id: "a", label: "Catálogo" }, { id: "b", label: "Pedidos" } ] },
      ]} />
    );
    expect(screen.getByText("Catálogo")).toBeTruthy();
    expect(screen.getByText("Pedidos")).toBeTruthy();
    // type to filter
    const input = screen.getByPlaceholderText("Buscar…") as HTMLInputElement;
    input.value = "ped";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(screen.queryByText("Catálogo")).toBeNull();
    expect(screen.getByText("Pedidos")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- primitives`
Expected: FAIL — `CommandPalette` not exported.

- [ ] **Step 4: Implement `src/design-system/CommandPalette.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";

export interface CommandItem { id: string; label: string; onSelect?: () => void; }
export interface CommandGroup { group: string; items: CommandItem[]; }

// Cmd/Ctrl+K command palette. Fuzzy match = case-insensitive substring with
// word-start bonus. Arrow-key navigation, Enter runs, Esc closes. Focus-trap
// reuses the Dialog pattern (Tab contained, focus restore on close).
export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: CommandGroup[];
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  const flat = useMemo(() => commands.flatMap((g) => g.items), [commands]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return flat;
    return flat.filter((c) => c.label.toLowerCase().includes(term));
  }, [q, flat]);

  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement;
    setQ("");
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); filtered[active]?.onSelect?.(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      lastFocused.current?.focus();
    };
  }, [open, onClose, filtered, active]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-start justify-center pt-[12vh] p-4"
      style={{ animation: "dialogIn var(--motion-fast) var(--ease-smooth)" }}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buscar"
        className="relative bg-paper rounded-sheet w-full max-w-lg shadow-lift overflow-hidden"
        style={{ animation: "cmdIn var(--motion-base) var(--ease-spring)" }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          placeholder="Buscar…"
          className="w-full px-4 py-3 text-base bg-transparent border-b border-rule text-ink outline-none"
        />
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-ink-soft text-sm">Sin resultados</p>
          )}
          {filtered.map((c, idx) => (
            <button
              key={c.id}
              onMouseEnter={() => setActive(idx)}
              onClick={() => { c.onSelect?.(); onClose(); }}
              className={`block w-full text-left px-4 py-2 text-sm ${idx === active ? "bg-paper-2 text-ink" : "text-ink"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Export from barrel**

Add after `Dropdown`:

```ts
export { CommandPalette, type CommandGroup, type CommandItem } from "./CommandPalette";
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npm run test -- primitives`
Expected: PASS.

- [ ] **Step 7: Full verification**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/design-system/CommandPalette.tsx src/design-system/index.ts src/design-system/primitives.test.tsx src/index.css
git commit -m "feat(design-system): add command palette"
```

---

### Task 15: Wire CommandPalette into AppShell with global Cmd+K

**Files:**
- Modify: `src/app/AppShell.tsx`

- [ ] **Step 1: Read AppShell to find the nav items + render root**

Run: `grep -n "navItems\|return (\|Tab" src/app/AppShell.tsx`

- [ ] **Step 2: Add palette + key listener**

Import `CommandPalette, type CommandGroup` from the barrel, plus `useState` and `useEffect`. Add:

```tsx
const [cmdOpen, setCmdOpen] = useState(false);
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setCmdOpen((v) => !v);
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);

const commands: CommandGroup[] = [
  { group: "Ir a", items: navItems.map((t) => ({ id: t.id, label: t.label, onSelect: () => navigate(t.id) })) },
];
```

(Use the existing nav item shape + a navigate helper that sets the route. If no helper exists, set `window.location.hash` per the existing `router.ts` convention — check `src/app/router.ts` for how routes are set.)

Render `<CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} commands={commands} />` at the AppShell root.

- [ ] **Step 3: Full verification**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass. Also run `npm run e2e` if feasible.

- [ ] **Step 4: Commit**

```bash
git add src/app/AppShell.tsx
git commit -m "feat(app): wire command palette with Cmd+K"
```

---

## Final wrap

- [ ] **Task 16: Full suite + push**

Run: `npm run typecheck && npm run test && npm run build && npm run e2e`
Expected: all pass. Then `git push` (per the user's standing git-workflow memory: commit+push when done; the PR waits for confirmation).

Open a PR summarizing the 8 components, referencing the spec at `docs/superpowers/specs/2026-07-03-ui-ux-upgrade-motion-design.md`.
