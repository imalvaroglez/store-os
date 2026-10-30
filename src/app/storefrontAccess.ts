import { OLIVIA_SLUG } from "../design-system";
import type { AppUser } from "./firebase/auth";
import type { RouteMatch } from "../lib/router";
import type { Store } from "../types";

export function canEditOliviaStorefront(route: RouteMatch, user: Pick<AppUser, "uid"> | null, store?: Pick<Store, "slug" | "ownerUid">): boolean {
  return (route.name === "public_store" || route.name === "storefront_editor")
    && route.params.slug === OLIVIA_SLUG
    && store?.slug === OLIVIA_SLUG
    && !!user
    && store.ownerUid === user.uid;
}
