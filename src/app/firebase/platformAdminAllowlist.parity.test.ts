import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static parity gate (#385 review, MENOR-2): the platform admin list must be
// IDENTICAL in firestore.rules and auth.ts. A change on one side alone would
// pass CI green and split super_admin behavior between client and rules.
// Same pattern as the canonicalEmail drift test / storage rules matrix.
function rulesAllowlist(): string[] {
  const rules = readFileSync("firestore.rules", "utf8");
  const match = rules.match(/isAllowlistedSuperAdmin\(\)\s*\{[\s\S]*?\[([\s\S]*?)\]/);
  if (!match) throw new Error("isAllowlistedSuperAdmin allowlist not found in firestore.rules");
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function clientAllowlist(): string[] {
  const auth = readFileSync("src/app/firebase/auth.ts", "utf8");
  const match = auth.match(/PLATFORM_ADMIN_EMAILS[^=]*=\s*\[([^\]]*)\]/);
  if (!match) throw new Error("PLATFORM_ADMIN_EMAILS not found in auth.ts");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("platform admin allowlist parity (client ↔ rules)", () => {
  it("is the same list on both sides", () => {
    expect(clientAllowlist().sort()).toEqual(rulesAllowlist().sort());
  });
});
