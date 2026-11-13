// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { AnimatedNumber } from "./AnimatedNumber";

// #406 — the count-up animation is armed by IntersectionObserver and driven by
// requestAnimationFrame. On a fresh login the totals mount with value 0 (orders
// still loading) and the real value lands ~1s later, MID-ANIMATION: the frames
// of the first (zero-target) run must not clobber the corrected value.
type ObserverCallback = IntersectionObserverCallback;
class IOStub {
  static instances: IOStub[] = [];
  callback: ObserverCallback;
  constructor(cb: ObserverCallback) {
    this.callback = cb;
    IOStub.instances.push(this);
  }
  observe = vi.fn(() => {
    queueMicrotask(() => this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
  });
  disconnect = vi.fn();
  unobserve = vi.fn();
}

let nextId = 1;
const frames = new Map<number, FrameRequestCallback>();
const raf = (cb: FrameRequestCallback) => {
  const id = nextId++;
  frames.set(id, cb);
  return id;
};
const caf = (id: number) => {
  frames.delete(id);
};
const stepFrames = (count: number) => {
  for (let i = 0; i < count; i++) {
    const pending = [...frames.entries()];
    frames.clear();
    for (const [, cb] of pending) cb(performance.now());
  }
};

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", IOStub);
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", caf);
  window.matchMedia = window.matchMedia ?? ((q: string) => ({ matches: false, media: q, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }) as unknown as MediaQueryList);
});

afterEach(() => {
  vi.unstubAllGlobals();
  IOStub.instances = [];
  frames.clear();
});

describe("AnimatedNumber (#406: carrera de carga inicial)", () => {
  it("un valor que llega a mitad de la animación hacia 0 no se sobreescribe por los frames viejos", async () => {
    // 1) Mount while orders are still loading: value 0, element visible.
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<AnimatedNumber value={0} format="currency" />);
      await Promise.resolve(); // IO callback arms the animation
    });
    await act(async () => {
      stepFrames(3); // frames of the 0-target run are in flight
    });

    // 2) Orders land: value jumps to the real total mid-animation.
    await act(async () => {
      view!.rerender(<AnimatedNumber value={2150} format="currency" />);
      await Promise.resolve(); // effect re-runs: started ⇒ setDisplay(2150)
    });

    // 3) The stale zero-target frames must be gone; the total stays.
    await act(async () => {
      stepFrames(10);
    });
    expect(view!.container.textContent).toBe("$2,150");
  });

  it("un valor que llega después de terminar la cuenta salta directo al total", async () => {
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<AnimatedNumber value={0} format="currency" />);
      await Promise.resolve();
    });
    await act(async () => {
      stepFrames(80); // first run completes (0 → 0)
    });
    await act(async () => {
      view!.rerender(<AnimatedNumber value={1200} format="currency" />);
      await Promise.resolve();
    });
    await act(async () => {
      stepFrames(2);
    });
    expect(view!.container.textContent).toBe("$1,200");
  });

  it("un conjunto realmente vacío sigue mostrando $0", async () => {
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<AnimatedNumber value={0} format="currency" />);
      await Promise.resolve();
    });
    await act(async () => {
      stepFrames(80);
    });
    expect(view!.container.textContent).toBe("$0");
  });

  it("un valor que llega a mitad de una animación hacia un total no cero tampoco se pisa (cobertura de revisión)", async () => {
    // Mount with a real total (cached data), animation 0→500 in flight, then
    // the total grows to 800 (another order lands): same cancel+settle path.
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<AnimatedNumber value={500} format="currency" />);
      await Promise.resolve();
    });
    await act(async () => {
      stepFrames(3);
    });
    await act(async () => {
      view!.rerender(<AnimatedNumber value={800} format="currency" />);
      await Promise.resolve();
    });
    await act(async () => {
      stepFrames(10);
    });
    expect(view!.container.textContent).toBe("$800");
  });

  it("si el observer nunca arma y el valor llega después del montaje, se muestra de inmediato", async () => {
    // IO present but its callback never delivers (throttled frames — the
    // embedded-webview case observed live in #406).
    vi.stubGlobal("IntersectionObserver", class NeverFires {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    });
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<AnimatedNumber value={0} format="currency" />);
      await Promise.resolve();
    });
    await act(async () => {
      view!.rerender(<AnimatedNumber value={22770} format="currency" />);
      await Promise.resolve();
    });
    expect(view!.container.textContent).toBe("$22,770");
  });

  it("si el observer nunca arma y el valor estaba desde el montaje, el fallback lo muestra", async () => {
    vi.stubGlobal("IntersectionObserver", class NeverFires {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    });
    vi.useFakeTimers();
    try {
      let view: ReturnType<typeof render>;
      await act(async () => {
        view = render(<AnimatedNumber value={1200} format="currency" />);
        await Promise.resolve();
      });
      expect(view!.container.textContent).toBe("$0"); // aún en espera del observer
      await act(async () => {
        vi.advanceTimersByTime(1600);
      });
      expect(view!.container.textContent).toBe("$1,200"); // fallback settle
    } finally {
      vi.useRealTimers();
    }
  });
});
