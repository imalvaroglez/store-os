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

// Suite B (#176) — member/owner/super_admin matrix for storage.rules.
//
// The Storage emulator cannot evaluate cross-service firestore.get() (the
// membership source) nor request.resource.contentType (see
// storage.rules.emulator for the original e2e note). To still prove the
// production LOGIC — paths, owner-vs-member distinctions, size caps, file
// name guards, create-only PDFs, public reads — this suite loads a copy of
// storage.rules where ONLY those emulator-blind fragments are replaced:
//
//   1. The three membership functions → synthetic auth-claims stubs
//      (request.auth.token.memberOf/ownerOf/isSuperAdmin), which are
//      logically equivalent to the firestore.get() reads they mirror.
//   2. The two contentType guards → removed (the emulator does not populate
//      contentType reliably).
//
// Everything else is the real production file. If storage.rules drifts, the
// exact-match transform below throws with a clear message, so this suite can
// never silently test an outdated shape. In production the contentType guards
// and the firestore.get() membership are enforced — they are verified by this
// drift guard (presence) plus code review, not by emulator evaluation.

const REAL_RULES = readFileSync("storage.rules", "utf8");

function mustReplaceExactlyOnce(source: string, before: string, after: string, what: string): string {
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(
      `storage.rules cambió (${what}: ${count} coincidencias, se esperaba 1). ` +
        "Actualiza el stub de storage.rules.matrix.test.ts para reflejar el archivo real."
    );
  }
  return source.replace(before, after);
}

function membershipStubbedRules(src: string): string {
  src = mustReplaceExactlyOnce(
    src,
    `    function isSuperAdmin() {
      return request.auth != null
        && firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data.role == 'super_admin';
    }`,
    `    function isSuperAdmin() {
      return request.auth != null && request.auth.token.isSuperAdmin == true;
    }`,
    "isSuperAdmin"
  );
  src = mustReplaceExactlyOnce(
    src,
    `    function isStoreMember(storeId) {
      return isSuperAdmin()
        || (request.auth != null
        && firestore.get(/databases/(default)/documents/adminStores/$(storeId)).data.memberUids.hasAny([request.auth.uid]));
    }`,
    `    function isStoreMember(storeId) {
      return isSuperAdmin()
        || (request.auth != null
        && request.auth.token.memberOf.hasAny([storeId]));
    }`,
    "isStoreMember"
  );
  src = mustReplaceExactlyOnce(
    src,
    `    function isStoreOwner(storeId) {
      return isSuperAdmin()
        || (request.auth != null
        && firestore.get(/databases/(default)/documents/adminStores/$(storeId)).data.ownerUid == request.auth.uid);
    }`,
    `    function isStoreOwner(storeId) {
      return isSuperAdmin()
        || (request.auth != null
        && request.auth.token.ownerOf == storeId);
    }`,
    "isStoreOwner"
  );
  // Emulator-blind contentType guards. Their PRESENCE in the real file is
  // pinned by the two assertions below, so removing them from storage.rules
  // fails this suite loudly instead of weakening production silently.
  src = mustReplaceExactlyOnce(
    src,
    `        && request.resource.contentType == 'application/pdf'
`,
    "",
    "pdf contentType guard"
  );
  src = mustReplaceExactlyOnce(
    src,
    `        && (request.resource.contentType == 'image/jpeg'
            || request.resource.contentType == 'image/png'
            || request.resource.contentType == 'image/webp')
`,
    "",
    "image contentType guard"
  );
  return src;
}

// Drift guards: the production rules MUST keep the emulator-blind guards the
// stub above removes — contentType allowlists for images and PDFs.
// Runs even without an emulator: these are pure file-content drift guards.
describe("storage.rules — emulator-blind guards still present in the real file", () => {
    it("keeps the image contentType allowlist", () => {
      if (!REAL_RULES.includes("request.resource.contentType == 'image/jpeg'")) {
        throw new Error("storage.rules ya no restringe contentType de imágenes: revisa el guard.");
      }
    });
    it("keeps the PDF contentType guard", () => {
      if (!REAL_RULES.includes("request.resource.contentType == 'application/pdf'")) {
        throw new Error("storage.rules ya no exige application/pdf en compras: revisa el guard.");
      }
    });
  }
);

let env: RulesTestEnvironment;

const PROJ = FIREBASE_DEV_PROJECT_ID;

// One outer gated suite: env init must NOT run when the storage emulator is
// absent (plain `npm run test` skips the whole matrix instead of hanging).
describe.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)("storage.rules matrix — #176", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: PROJ,
      storage: { rules: membershipStubbedRules(REAL_RULES) },
    });
  });

const MAX = 16 * 1024 * 1024;
const IMG_MAX = 5 * 1024 * 1024;
const PDF_MAX = 10 * 1024 * 1024;

// Synthetic membership mirroring the adminStores control plane the stub
// replaces: u_m1 is a plain member of s1, u_o1 owns s1, u_m2 owns s2 only,
// u_sa is the platform super_admin.
const anon = () => env.unauthenticatedContext().storage();
const member1 = () => env.authenticatedContext("u_m1", { memberOf: ["s1"] }).storage();
const owner1 = () => env.authenticatedContext("u_o1", { memberOf: ["s1"], ownerOf: "s1" }).storage();
const member2 = () => env.authenticatedContext("u_m2", { memberOf: ["s2"], ownerOf: "s2" }).storage();
const superAdmin = () => env.authenticatedContext("u_sa", { isSuperAdmin: true }).storage();

const jpg = (size = 8) => new Uint8Array(size);

describe(
  "storage.rules matrix — purchases PDFs (private, create-only)",
  () => {
    it("a store member can upload and read their store's purchase PDF", async () => {
      await assertSucceeds(
        uploadBytes(ref(member1(), "purchases/s1/order-1.pdf"), jpg(16), {
          contentType: "application/pdf",
        })
      );
      await assertSucceeds(getBytes(ref(member1(), "purchases/s1/order-1.pdf"), MAX));
    });

    it("another store's member cannot read or write purchase PDFs", async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await uploadBytes(ref(ctx.storage(), "purchases/s1/order-2.pdf"), jpg(16), {
          contentType: "application/pdf",
        });
      });
      await assertFails(getBytes(ref(member2(), "purchases/s1/order-2.pdf"), MAX));
      await assertFails(
        uploadBytes(ref(member2(), "purchases/s1/intruso.pdf"), jpg(16), {
          contentType: "application/pdf",
        })
      );
    });

    it("a non-.pdf file name is rejected", async () => {
      await assertFails(
        uploadBytes(ref(member1(), "purchases/s1/order.exe"), jpg(16), {
          contentType: "application/pdf",
        })
      );
    });

    it("PDFs above 10MB are rejected", async () => {
      await assertFails(
        uploadBytes(ref(member1(), "purchases/s1/grande.pdf"), new Uint8Array(PDF_MAX + 1), {
          contentType: "application/pdf",
        })
      );
    });

    it("purchase PDFs are immutable: even the owner cannot rewrite one", async () => {
      await assertSucceeds(
        uploadBytes(ref(owner1(), "purchases/s1/orden-3.pdf"), jpg(16), {
          contentType: "application/pdf",
        })
      );
      await assertFails(
        uploadBytes(ref(owner1(), "purchases/s1/orden-3.pdf"), jpg(32), {
          contentType: "application/pdf",
        })
      );
    });

    it("only the owner can delete a purchase PDF", async () => {
      await assertSucceeds(
        uploadBytes(ref(owner1(), "purchases/s1/orden-4.pdf"), jpg(16), {
          contentType: "application/pdf",
        })
      );
      await assertFails(deleteObject(ref(member1(), "purchases/s1/orden-4.pdf")));
      await assertSucceeds(deleteObject(ref(owner1(), "purchases/s1/orden-4.pdf")));
    });
  }
);

describe(
  "storage.rules matrix — product photos (public read, member write)",
  () => {
    it("anonymous can read; a member can upload, rewrite and delete", async () => {
      await assertSucceeds(
        uploadBytes(ref(member1(), "products/s1/collar-1.jpg"), jpg(16), {
          contentType: "image/jpeg",
        })
      );
      await assertSucceeds(getBytes(ref(anon(), "products/s1/collar-1.jpg"), MAX));
      // create,update: a member may replace their own store's photo.
      await assertSucceeds(
        uploadBytes(ref(member1(), "products/s1/collar-1.jpg"), jpg(32), {
          contentType: "image/jpeg",
        })
      );
      await assertSucceeds(deleteObject(ref(member1(), "products/s1/collar-1.jpg")));
    });

    it("another store's member cannot write here", async () => {
      await assertFails(
        uploadBytes(ref(member2(), "products/s1/intruso.jpg"), jpg(16), {
          contentType: "image/jpeg",
        })
      );
    });

    it("a non-.jpg file name is rejected", async () => {
      await assertFails(
        uploadBytes(ref(member1(), "products/s1/foto.png"), jpg(16), {
          contentType: "image/png",
        })
      );
    });

    it("images above 5MB are rejected", async () => {
      await assertFails(
        uploadBytes(ref(member1(), "products/s1/grande.jpg"), new Uint8Array(IMG_MAX + 1), {
          contentType: "image/jpeg",
        })
      );
    });

    it("the platform super_admin can operate any store's photos", async () => {
      await assertSucceeds(
        uploadBytes(ref(superAdmin(), "products/s2/sa.jpg"), jpg(16), {
          contentType: "image/jpeg",
        })
      );
      await assertSucceeds(deleteObject(ref(superAdmin(), "products/s2/sa.jpg")));
    });
  }
);

describe(
  "storage.rules matrix — category images mirror product rules",
  () => {
    it("member of the store writes; other store's member cannot", async () => {
      await assertSucceeds(
        uploadBytes(ref(member1(), "categories/s1/anillos-1.jpg"), jpg(16), {
          contentType: "image/jpeg",
        })
      );
      await assertFails(
        uploadBytes(ref(member2(), "categories/s1/intruso.jpg"), jpg(16), {
          contentType: "image/jpeg",
        })
      );
    });
  }
);

describe(
  "storage.rules matrix — storefront images are OWNER-only",
  () => {
    it("a plain member cannot write or delete the storefront", async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await uploadBytes(ref(ctx.storage(), "storefront/s1/brand.jpg"), jpg(16), {
          contentType: "image/jpeg",
        });
      });
      await assertFails(
        uploadBytes(ref(member1(), "storefront/s1/otra.jpg"), jpg(16), {
          contentType: "image/jpeg",
        })
      );
      await assertFails(deleteObject(ref(member1(), "storefront/s1/brand.jpg")));
    });

    it("the owner manages the storefront and anyone can read it", async () => {
      await assertSucceeds(
        uploadBytes(ref(owner1(), "storefront/s1/brand-2.jpg"), jpg(16), {
          contentType: "image/jpeg",
        })
      );
      await assertSucceeds(getBytes(ref(anon(), "storefront/s1/brand-2.jpg"), MAX));
      await assertSucceeds(deleteObject(ref(owner1(), "storefront/s1/brand-2.jpg")));
    });
  }
);
});
