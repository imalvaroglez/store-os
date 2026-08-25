import type { Store } from "../types";

// Membership helpers. Extracted from StoreProvider after the 2026-08-25
// incident (docs/incidents/2026-08-25-membership-wipe.md): the old
// storeWithMembership unconditionally wrote memberUids=[current user], so
// background writes at login (pendingInvites backfill, catalog migration)
// silently erased every other member from BOTH planes. These functions are
// PRESERVE-first: defaults are only created when the store carries no
// membership at all (creation); an existing membership is never replaced.

export type SessionUser = { uid: string } | null;

/**
 * Attach membership defaults for a NEW store, or preserve the existing
 * membership (adding the current user if missing). Never drops anyone.
 */
export function storeWithMembership<T extends Store>(
  store: T,
  user: SessionUser
): T & { ownerUid?: string; memberUids?: string[] } {
  if (!user) return store;
  const memberUids = store.memberUids?.length
    ? store.memberUids.includes(user.uid)
      ? store.memberUids
      : [...store.memberUids, user.uid]
    : [user.uid];
  return { ...store, ownerUid: store.ownerUid ?? user.uid, memberUids };
}

function canonical(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * True when legacy pendingInvites are not in canonical form (case, whitespace,
 * duplicates) and the login backfill must rewrite them.
 */
export function invitesNeedBackfill(invites: string[] | undefined): boolean {
  if (!invites || invites.length === 0) return false;
  const normalized = Array.from(new Set(invites.map(canonical)));
  return normalized.length !== invites.length || invites.some((e) => e !== canonical(e));
}
