// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StorefrontEditor } from "./StorefrontEditor";
import { PublicCatalogProjectionError } from "../../app/firebase/firestoreData";
import type { Store } from "../../types";

const mocks = vi.hoisted(() => ({ updateStore: vi.fn(), upload: vi.fn(), remove: vi.fn(), resize: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("../../app/StoreProvider", () => ({ useStore: () => ({ updateStore: mocks.updateStore, cloud: true }) }));
vi.mock("../../app/firebase/storage", () => ({ resizeImageFile: mocks.resize, uploadStorefrontImage: mocks.upload, deleteStorefrontImage: mocks.remove }));
vi.mock("../../design-system", async (importOriginal) => ({ ...await importOriginal<object>(), useToast: () => ({ success: mocks.success, error: mocks.error }) }));
const store = { id: "s1", slug: "olivia", name: "Olivia", type: "inventory_tiered", storefront: { logoUrl: "https://example.com/old.png", hero: { heading: "Mi texto", imageUrl: "https://example.com/banner.jpg" } } } as Store;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resize.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  mocks.upload.mockResolvedValue("https://example.com/new.png");
  mocks.updateStore.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
async function chooseLogo(container: HTMLElement) {
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["photo"], "logo.png", { type: "image/png" })] } });
  await waitFor(() => expect(screen.getByRole("img", { name: "Vista previa: Logo" })).toHaveAttribute("src", "blob:preview"));
}

describe("storefront images", () => {
  it("previews locally, uploads only on save, preserves transparency, then cleans previous files", async () => {
    const done = vi.fn();
    const { container } = render(<StorefrontEditor store={store} onDone={done} />);
    await chooseLogo(container);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.resize).toHaveBeenCalledWith(expect.any(File), { transparent: true, maxEdge: 600 });
    fireEvent.click(screen.getByRole("button", { name: "Guardar sitio público" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(mocks.updateStore).toHaveBeenCalledWith({ id: "s1", storefront: { ...store.storefront, logoUrl: "https://example.com/new.png" } });
    expect(mocks.remove).toHaveBeenCalledWith("s1", "https://example.com/old.png");
    expect(mocks.updateStore.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]);
  });

  it("retains both images on a publication failure and retries without another upload", async () => {
    mocks.updateStore.mockRejectedValueOnce(new PublicCatalogProjectionError(new Error("offline")));
    const done = vi.fn();
    const { container } = render(<StorefrontEditor store={store} onDone={done} />);
    await chooseLogo(container);
    fireEvent.click(screen.getByRole("button", { name: "Guardar sitio público" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Guardar sitio público" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it("keeps current content after upload failure and explicitly clears a removed image", async () => {
    mocks.upload.mockRejectedValueOnce(new Error("offline"));
    const { container } = render(<StorefrontEditor store={store} onDone={() => {}} />);
    await chooseLogo(container);
    fireEvent.click(screen.getByRole("button", { name: "Guardar sitio público" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.updateStore).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Quitar logo" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar sitio público" }));
    await waitFor(() => expect(mocks.updateStore).toHaveBeenCalledWith({ id: "s1", storefront: { ...store.storefront, logoUrl: "" } }));
  });

  it("suggests content only when requested, retaining brand images", async () => {
    render(<StorefrontEditor store={store} onDone={() => {}} />);
    expect(screen.getByLabelText("Título principal")).toHaveValue("Mi texto");
    fireEvent.click(screen.getByRole("button", { name: "Usar textos sugeridos" }));
    expect(screen.getByLabelText("Título principal")).toHaveValue("Joyería para hacer tuyo cada día");
    expect(screen.getByRole("img", { name: "Vista previa: Portada de escritorio" })).toHaveAttribute("src", "https://example.com/banner.jpg");
    expect(mocks.updateStore).not.toHaveBeenCalled();
  });
});
