// Olivia's centralized, non-editable brand config. Colors and typography live
// here (not in components, not in the admin UI) so they're defined once and Fer
// cannot accidentally scatter them. The storefront applies these as a fixed
// theme; the admin panel keeps using the regular app theme.
//
// ponytail: a plain constant, not a theme engine. When a second store needs its
// own brand, promote this to a per-store brand map keyed by storeId.

export const OLIVIA_BRAND = {
  // Ivory background, dark ink text, sober rose accent.
  bg: "#F7F2EC", // marfil
  ink: "#2B2724", // texto oscuro
  inkSoft: "#6B6258",
  accent: "#C97B86", // rosa sobrio
  accentSoft: "#E7C9CE",
  rule: "#E2D8CC",
  // Headings: Playfair Display. Body: Plus Jakarta Sans. Loaded in index.html.
  fontDisplay: '"Playfair Display", Georgia, serif',
  fontBody: '"Plus Jakarta Sans", system-ui, sans-serif',
} as const;

export const OLIVIA_SLUG = "olivia";

// Default storefront content for Olivia, used until Fer fills it in. Clearly
// provisional copy so it's obvious what to replace.
export const OLIVIA_DEFAULT_STOREFRONT = {
  hero: {
    heading: "Olivia",
    body: "Joyería hecha a mano, piezas únicas para cada ocasión.",
  },
  benefits: [
    "Envíos a todo el país",
    "Plata 925 y materiales de calidad",
    "Cada pieza es única",
  ],
  story: {
    heading: "Nuestra historia",
    body: "Cuenta aquí la historia de Olivia. (Texto provisional — edítalo en Sitio público.)",
  },
  resale: {
    heading: "Vende con Olivia",
    body: "¿Quieres formar parte del programa de reventa? Escríbeme por WhatsApp.",
  },
  faq: [
    { q: "¿Hacen envíos?", a: "Sí, a todo el país. (Texto provisional.)" },
    { q: "¿Cómo cuido mis piezas?", a: "Evita el contacto con agua y perfumes. (Provisional.)" },
  ],
  notice: "",
  shipping: "Envíos a todo el país. (Provisional.)",
  payments: ["Transferencia", "Efectivo"],
  policies: "Devoluciones dentro de 7 días. (Provisional.)",
  hours: "Lunes a sábado, 10:00–18:00. (Provisional.)",
  instagram: "",
  whatsappBuyIntro: "Hola, me interesa esta pieza:",
  whatsappResaleIntro: "Hola, quiero información sobre el programa de reventa.",
  showSoldOut: true,
} as const;
