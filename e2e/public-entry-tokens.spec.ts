import { test, expect } from "@playwright/test";

// #484 P4c (critical review finding): the PUBLIC entry has no ThemeProvider —
// if the CSS layer order ever inverts again, self-referential @theme tokens
// resolve to invalid cycles and every radius/shadow silently dies for the
// anonymous visitor. This gate fails on computed styles, not on classes.
test("public entry resolves radius/shadow tokens without ThemeProvider (#484 P4c)", async ({ page }) => {
  await page.goto("/catalogo/olivia", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const computed = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "rounded-lg shadow-card";
    probe.style.cssText = "position:absolute;visibility:hidden";
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const out = {
      radiusVar: getComputedStyle(document.documentElement).getPropertyValue("--radius-lg").trim(),
      radius: cs.borderRadius,
      shadow: cs.boxShadow,
    };
    probe.remove();
    return out;
  });
  expect(computed.radiusVar).not.toBe("");
  expect(computed.radius).not.toBe("0px");
  expect(computed.shadow).not.toBe("none");
});
