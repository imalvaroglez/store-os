// Fixed storefront token preset. It stays in the design system so the public
// experience uses the same token contract as the rest of Store OS.
export const OLIVIA_BRAND = {
  bg: "#F7F2EC",
  ink: "#2B2724",
  inkSoft: "#6B6258",
  accent: "#C97B86",
  accentSoft: "#E7C9CE",
  rule: "#E2D8CC",
  fontDisplay: '"Playfair Display", Georgia, serif',
  fontBody: '"Plus Jakarta Sans", system-ui, sans-serif',
} as const;

export const OLIVIA_SLUG = "olivia";

export const OLIVIA_DEFAULT_STOREFRONT = {
  hero: { heading: "Olivia", body: "Joyería y accesorios para acompañar tus momentos." },
  benefits: [],
  story: { heading: "Nuestra historia", body: "" },
  resale: { heading: "Vende con Olivia", body: "" },
  faq: [],
  notice: "",
  payments: [],
  showSoldOut: true,
} as const;
