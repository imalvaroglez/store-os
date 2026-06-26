// Small unique-id helper. crypto.randomUUID when available, else fallback.
// ponytail: one-liner good enough; collision risk on fallback is negligible for local-first.
export function uid(prefix = ""): string {
  const core =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix ? `${prefix}_${core}` : core;
}
