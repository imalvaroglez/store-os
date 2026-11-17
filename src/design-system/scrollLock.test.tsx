// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { Sheet } from "./Sheet";
import { Dialog } from "./Dialog";

// #463 QA UX bloqueante (scroll 2/5): locking body scroll with plain
// `overflow: hidden` collapses the document scroll to 0 (body overflow
// propagates to the viewport), and the route-change reset races the Sheet's
// focus-return scroll. The operator's catalog position must survive an
// open→close cycle BY CONSTRUCTION: capture `window.scrollY` at lock time and
// restore it on unlock.
describe("body scroll lock preserves the document position (#463)", () => {
  let scrollYValue: number;
  const scrollToSpy = vi.fn();

  beforeEach(() => {
    scrollYValue = 0;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => scrollYValue,
    });
    scrollToSpy.mockReset();
    window.scrollTo = ((x: number, y: number) => {
      scrollToSpy(x, y);
      scrollYValue = y;
    }) as typeof window.scrollTo;
  });

  afterEach(() => {
    document.body.style.overflow = "";
    vi.restoreAllMocks();
  });

  it("Sheet restores the scroll position captured when it opened", async () => {
    const { rerender } = render(
      <Sheet open={false} onClose={() => {}} title="Desglose">
        contenido
      </Sheet>,
    );
    // The operator is scrolled down the catalog when the sheet opens.
    scrollYValue = 2400;
    await act(async () => {
      rerender(
        <Sheet open onClose={() => {}} title="Desglose">
          contenido
        </Sheet>,
      );
    });
    expect(document.body.style.overflow).toBe("hidden");
    // While locked the viewport clamps to 0 — the lock must not lose the
    // position it captured at open.
    scrollYValue = 0;
    await act(async () => {
      rerender(
        <Sheet open={false} onClose={() => {}} title="Desglose">
          contenido
        </Sheet>,
      );
    });
    expect(scrollToSpy).toHaveBeenCalledWith(0, 2400);
    expect(document.body.style.overflow).toBe("");
  });

  it("Dialog restores the scroll position captured when it opened", async () => {
    const { rerender } = render(
      <Dialog open={false} onClose={() => {}} title="Confirmar">
        contenido
      </Dialog>,
    );
    scrollYValue = 1300;
    await act(async () => {
      rerender(
        <Dialog open onClose={() => {}} title="Confirmar">
          contenido
        </Dialog>,
      );
    });
    expect(document.body.style.overflow).toBe("hidden");
    scrollYValue = 0;
    await act(async () => {
      rerender(
        <Dialog open={false} onClose={() => {}} title="Confirmar">
          contenido
        </Dialog>,
      );
    });
    expect(scrollToSpy).toHaveBeenCalledWith(0, 1300);
  });

  it("nested locks restore in reverse order (inner 0 → outer position)", async () => {
    const sheet = render(
      <Sheet open={false} onClose={() => {}} title="Hoja">
        a
      </Sheet>,
    );
    const dialog = render(
      <Dialog open={false} onClose={() => {}} title="Diálogo">
        b
      </Dialog>,
    );
    scrollYValue = 900;
    await act(async () => {
      sheet.rerender(
        <Sheet open onClose={() => {}} title="Hoja">
          a
        </Sheet>,
      );
    });
    // The dialog opens while the sheet holds the lock; the clamped document
    // is at 0 and THAT is the position the inner lock must restore.
    scrollYValue = 0;
    await act(async () => {
      dialog.rerender(
        <Dialog open onClose={() => {}} title="Diálogo">
          b
        </Dialog>,
      );
    });
    await act(async () => {
      dialog.rerender(
        <Dialog open={false} onClose={() => {}} title="Diálogo">
          b
        </Dialog>,
      );
    });
    expect(scrollToSpy).toHaveBeenLastCalledWith(0, 0);
    await act(async () => {
      sheet.rerender(
        <Sheet open={false} onClose={() => {}} title="Hoja">
          a
        </Sheet>,
      );
    });
    expect(scrollToSpy).toHaveBeenLastCalledWith(0, 900);
  });
});
