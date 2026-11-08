import { beforeAll, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";
import { readFileSync } from "node:fs";
import { FIREBASE_DEV_PROJECT_ID } from "./projectIds";

// Suite A (#176) — the REAL storage.rules loaded in the Storage emulator.
// What the emulator can prove about the production file: the anonymous
// boundary. Signed-in matrices cannot run here: the emulator cannot evaluate
// cross-service firestore.get(), so every authenticated request 403s
// regardless of membership (see storage.rules.emulator). The member/owner
// matrix runs in storage.rules.matrix.test.ts against a claims-stubbed copy
// of these same rules. contentType guards are also emulator-blind; the
// matrix's transform fails loudly if they ever drift from storage.rules.
let env: RulesTestEnvironment;

const PROJ = FIREBASE_DEV_PROJECT_ID;

const MAX = 16 * 1024 * 1024;

describe.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)(
  "storage.rules — anonymous boundary (real rules)",
  () => {
    beforeAll(async () => {
      env = await initializeTestEnvironment({
        projectId: PROJ,
        storage: { rules: readFileSync("storage.rules", "utf8") },
      });
    });

    it("anonymous can read public product photos (public catalog)", async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await uploadBytes(ref(ctx.storage(), "products/s1/pieza.jpg"), new Uint8Array([1]), {
          contentType: "image/jpeg",
        });
      });
      const st = env.unauthenticatedContext().storage();
      await assertSucceeds(getBytes(ref(st, "products/s1/pieza.jpg"), MAX));
    });

    it("anonymous can read public storefront and category images", async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await uploadBytes(ref(ctx.storage(), "storefront/s1/brand.jpg"), new Uint8Array([1]), {
          contentType: "image/jpeg",
        });
        await uploadBytes(ref(ctx.storage(), "categories/s1/collar.jpg"), new Uint8Array([1]), {
          contentType: "image/jpeg",
        });
      });
      const st = env.unauthenticatedContext().storage();
      await assertSucceeds(getBytes(ref(st, "storefront/s1/brand.jpg"), MAX));
      await assertSucceeds(getBytes(ref(st, "categories/s1/collar.jpg"), MAX));
    });

    it("anonymous CANNOT read supplier purchase PDFs (private evidence)", async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await uploadBytes(ref(ctx.storage(), "purchases/s1/order.pdf"), new Uint8Array([1]), {
          contentType: "application/pdf",
        });
      });
      const st = env.unauthenticatedContext().storage();
      await assertFails(getBytes(ref(st, "purchases/s1/order.pdf"), MAX));
    });

    it("anonymous CANNOT write or delete anything, public paths included", async () => {
      const st = env.unauthenticatedContext().storage();
      const bytes = new Uint8Array([1]);
      await assertFails(
        uploadBytes(ref(st, "products/s1/subida.jpg"), bytes, { contentType: "image/jpeg" })
      );
      await assertFails(
        uploadBytes(ref(st, "categories/s1/subida.jpg"), bytes, { contentType: "image/jpeg" })
      );
      await assertFails(
        uploadBytes(ref(st, "storefront/s1/subida.jpg"), bytes, { contentType: "image/jpeg" })
      );
      await assertFails(
        uploadBytes(ref(st, "purchases/s1/subida.pdf"), bytes, { contentType: "application/pdf" })
      );
      await assertFails(deleteObject(ref(st, "products/s1/pieza.jpg")));
    });
  }
);
