// Shared slug derivation. Used by store create/rename so the slug the client
// computes matches the one enforced server-side by claimSlug.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
