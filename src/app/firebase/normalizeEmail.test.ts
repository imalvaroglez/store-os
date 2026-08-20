import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./auth";

// normalizeEmail must stay IDENTICAL to canonicalEmail() in firestore.rules
// (a rules test covers the Gmail cases end-to-end to catch drift).
describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Mar@Example.COM ")).toBe("mar@example.com");
  });
  it("strips local-part dots on Gmail and folds googlemail", () => {
    expect(normalizeEmail("A.B.C@gmail.com")).toBe("abc@gmail.com");
    expect(normalizeEmail("a.b@googlemail.com")).toBe("ab@gmail.com");
  });
  it("keeps dots on non-Gmail domains (they are significant)", () => {
    expect(normalizeEmail("a.b@outlook.com")).toBe("a.b@outlook.com");
  });
  it("leaves malformed input untouched (no throw)", () => {
    expect(normalizeEmail("not-an-email")).toBe("not-an-email");
  });
});
