import { test, expect, type Request } from "@playwright/test";
import { FORBIDDEN_TELEMETRY_ROUTES } from "../src/app/firebase/rules-allowlist";

// G-P08 runtime gate: no egress to telemetry routes/hosts. The static gate
// (security-allowlist.gate.test.ts) catches telemetry SDKs/imports; this spec
// catches the sendBeacon/fetch the static gate cannot see. It runs against the
// production preview build (DEV=false, no Firebase emulator) so any reintroduced
// @vercel/analytics / @vercel/speed-insights call would fire its same-origin
// /_vercel/insights request here.
//
// We load the Olivia storefront (/catalogo/olivia) — a static brand route that
// renders without auth and without Firestore, so the only requests should be
// same-origin app assets. Every outbound request is checked against (1) the
// forbidden telemetry routes and (2) an allow-list of legitimate hosts.

test("catalog route makes no request to forbidden telemetry routes or hosts", async ({ page, baseURL }) => {
  // Resolve the app origin once up front. A request (including the document
  // navigation itself) can fire before page.url() reflects the final origin, so
  // comparing against the configured baseURL is more reliable than page.url().
  const appOrigin = new URL(baseURL ?? "http://localhost:4319").origin;
  const violations: string[] = [];

  page.on("request", (req: Request) => {
    const url = req.url();

    // (1) No forbidden telemetry route (same-origin Vercel insights paths).
    for (const route of FORBIDDEN_TELEMETRY_ROUTES) {
      if (url.includes(route)) {
        violations.push(`${url} (forbidden route ${route})`);
      }
    }

    // (2) No host outside the allow-list.
    try {
      const u = new URL(url);
      const allowedHost =
        u.origin === appOrigin ||
        u.hostname.endsWith("googleapis.com") ||
        u.hostname.endsWith("firebaseapp.com") ||
        u.hostname.endsWith("firebasedatabase.app") ||
        u.hostname === "wa.me" ||
        // Google Fonts CDN: src/index.css @imports the webfont CSS, which then
        // loads the .woff2 files. Design-system typography, not telemetry.
        u.hostname === "fonts.googleapis.com" ||
        u.hostname === "fonts.gstatic.com" ||
        // data: URIs (inlined assets) are not network egress.
        u.protocol === "data:";
      if (!allowedHost) {
        violations.push(`${url} (host ${u.hostname})`);
      }
    } catch {
      // Non-URL request string (relative in some contexts) — ignore; relative
      // requests resolve to the app origin and are covered by the appOrigin check.
    }
  });

  // domcontentloaded (not networkidle): a pending Firestore socket to the dev
  // backend in CI never lets the network go idle, which would time out
  // waitForLoadState("networkidle"). Telemetry SDKs fire their beacons during
  // the initial bundle load — well before DOMContentLoaded — so this is enough
  // to catch them.
  await page.goto("/catalogo/olivia", { waitUntil: "domcontentloaded" });
  // Give any lazy beacon a beat to fire, then assert.
  await page.waitForTimeout(1000);

  expect(violations, `forbidden egress:\n${violations.join("\n")}`).toEqual([]);
});
