import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), url: vi.fn() }));
vi.mock("./config", () => ({ getFirebase: () => ({ app: {} }) }));
vi.mock("firebase/storage", () => ({
  getStorage: () => ({}), connectStorageEmulator: vi.fn(),
  ref: (_storage: unknown, path = "") => {
    if (path.startsWith("https://")) throw new Error("invalid URL");
    if (path.startsWith("gs://")) {
      const [, bucket, fullPath] = path.match(/^gs:\/\/([^/]+)\/(.*)$/)!;
      return { bucket, fullPath };
    }
    return { bucket: "ours", fullPath: path };
  },
  uploadBytes: mocks.upload, deleteObject: mocks.remove, getDownloadURL: mocks.url,
}));
import { deleteStorefrontImage, uploadStorefrontImage } from "./storage";
beforeEach(() => { vi.clearAllMocks(); mocks.upload.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined); mocks.url.mockResolvedValue("public-url"); });
it("uses a unique path and preserves the processed MIME type", async () => {
  const image = new Blob(["png"], { type: "image/png" });
  await uploadStorefrontImage("s1", image);
  await uploadStorefrontImage("s1", image);
  const [first, second] = mocks.upload.mock.calls;
  expect(first[0].fullPath).toMatch(/^storefront\/s1\/brand-.*\.jpg$/);
  expect(first[0].fullPath).not.toBe(second[0].fullPath);
  expect(first[2]).toEqual({ contentType: "image/png" });
});
it("never removes another store, bucket, external URL or unmanaged file", async () => {
  for (const path of ["gs://other/storefront/s1/brand-a.jpg", "gs://ours/storefront/s2/brand-a.jpg", "gs://ours/products/s1/a.jpg", "gs://ours/storefront/s1/legacy.jpg", "https://example.com/logo.png"]) await deleteStorefrontImage("s1", path);
  expect(mocks.remove).not.toHaveBeenCalled();
  await deleteStorefrontImage("s1", "gs://ours/storefront/s1/brand-a.jpg");
  expect(mocks.remove).toHaveBeenCalledTimes(1);
  mocks.remove.mockRejectedValueOnce({ code: "storage/unauthorized" });
  await expect(deleteStorefrontImage("s1", "gs://ours/storefront/s1/brand-a.jpg")).rejects.toEqual({ code: "storage/unauthorized" });
});
