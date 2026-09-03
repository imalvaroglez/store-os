import { test, expect } from "@playwright/test";
import { loginAsFirstAdmin, signUp, unique } from "./helpers";

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
  await loginAsFirstAdmin(pageA);

  // Invite B from the store management view (picker → Administrar Santi).
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
