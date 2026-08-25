import { test, expect } from "@playwright/test";
import { adminToken, loginAsFirstAdmin, signUp, unique, PROJECT, writeEmulatorDoc } from "./helpers";

// reliable-member-invitations: the end-to-end closure. A invites B by email →
// B creates their account → reconciliation (login path) adds B to the store →
// B sees the store in "¿Quién opera hoy?" and A's pending list empties.
// Password signup here stands in for Google: both funnel through the same
// afterLogin → ensureUserDoc → reconcilePendingInvites sequence.
test("invite by email reconciles on the invitee's login", async ({ browser }) => {
  // Two full account bootstraps (A's seeded admin + B's signup+verify+login)
  // exceed the 40s default; give the whole cycle room.
  test.setTimeout(180_000);
  const bEmail = unique("invitada"); // already lowercase, no dots → canonical form

  // A: the allow-listed admin, owns Santi (seeded by loginAsFirstAdmin).
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await loginAsFirstAdmin(pageA, "invite");

  // Invite B from the store settings sheet (picker → Administrar Santi).
  await pageA.getByRole("button", { name: /Cambiar tienda/ }).first().click();
  await expect(pageA.getByText("¿Quién opera hoy?")).toBeVisible({ timeout: 15_000 });
  await pageA.getByRole("button", { name: "Administrar Santi" }).click();
  await expect(pageA.getByRole("heading", { name: "Administrar tienda" })).toBeVisible();

  await pageA.getByLabel("Buscar por correo").fill(bEmail);
  await pageA.getByRole("button", { name: "Buscar cuenta" }).click();
  // No account yet → the invite-by-email fallback is offered.
  await expect(pageA.getByText(/No hay una cuenta con ese correo/)).toBeVisible();
  await pageA.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(pageA.getByText("Invitación enviada. Quedará pendiente hasta que la persona cree su cuenta.")).toBeVisible();
  await expect(pageA.getByText(`${bEmail} · pendiente`)).toBeVisible();

  // B: fresh context, creates an account. The AuthProvider subscription runs
  // the same afterLogin sequence as any login and reconciles the invite.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await signUp(pageB, bEmail, "password123");

  // loadCloudState auto-selects stores[0], so a single-store user lands on
  // Inicio directly (no picker) — the reconciliation is what put Santi there.
  await expect(pageB.getByRole("heading", { name: "Inicio", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(pageB.getByRole("button", { name: /Santi/ }).first()).toBeVisible({ timeout: 20_000 });

  // A: the pending invite disappears (cloud subscription updates the state).
  await expect(pageA.getByText(`${bEmail} · pendiente`)).toHaveCount(0, { timeout: 20_000 });

  await ctxA.close();
  await ctxB.close();
});

// 2026-08-25 regression (docs/incidents/2026-08-25-membership-wipe.md): a
// legacy non-canonical pendingInvite triggered the login backfill, which used
// storeWithMembership to write memberUids=[logged-in user] — silently erasing
// every other member from BOTH planes. This test pins the preserve semantics.
test("login backfill of legacy invites never wipes members", async ({ browser }) => {
  test.setTimeout(120_000);
  const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
  const MEMBER_B = "member_b_regression_uid";

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAsFirstAdmin(page, "backfill");

  // Simulate the pre-incident state: another member + a legacy non-canonical
  // invite (written by the owner via REST, as rules allow).
  const auth = await adminToken("admin@store.os", "password123");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` };
  const storeId = "store_santi"; // deterministic fixture id (e2e/seed.ts)
  const santiRes = await fetch(`${FS}/stores/${storeId}`, { headers });
  expect(santiRes.ok).toBe(true);
  const ownerUid = (await santiRes.json()).fields.ownerUid.stringValue;
  const before = [ownerUid, MEMBER_B];

  const fixtureFields = {
    ownerUid: { stringValue: ownerUid }, // rules require it present in the write
    memberUids: { arrayValue: { values: before.map((u) => ({ stringValue: u })) } },
    pendingInvites: { arrayValue: { values: [{ stringValue: "Legacy@Example.COM " }] } },
  };
  const storesRes = await fetch(`${FS}/stores/${storeId}`, {
    method: "PATCH", headers, body: JSON.stringify({ fields: fixtureFields }),
  });
  // The app treats adminStores as canonical (super_admin reads it): write the
  // same membership + legacy invite to BOTH planes, as the app itself would.
  const adminRes = await fetch(`${FS}/adminStores/${storeId}`, {
    method: "PATCH", headers, body: JSON.stringify({ fields: fixtureFields }),
  });
  expect(storesRes.ok, `stores fixture: ${storesRes.status}`).toBe(true);
  expect(adminRes.ok, `adminStores fixture: ${adminRes.status}`).toBe(true);

  // Re-login: the pendingInvites normalization backfill fires on load.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Inicio", exact: true })).toBeVisible({ timeout: 20_000 });

  // The invite got normalized, but membership in BOTH planes must be intact.
  const readMembers = async (col: string) => {
    const res = await fetch(`${FS}/${col}/${storeId}`, { headers });
    if (!res.ok) return null;
    const fields = (await res.json()).fields ?? {};
    return (fields.memberUids?.arrayValue?.values ?? []).map((v: { stringValue: string }) => v.stringValue).sort();
  };
  const expected = JSON.stringify([before.slice().sort(), before.slice().sort()]);
  await expect
    .poll(async () => JSON.stringify([await readMembers("stores"), await readMembers("adminStores")]), {
      timeout: 20_000,
    })
    .toBe(expected);

  await ctx.close();
});
