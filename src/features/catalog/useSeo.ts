import { useEffect } from "react";

// Per-route SEO: sets <title>, canonical, Open Graph, Twitter Card, and an
// optional JSON-LD block. Pure DOM effects — no SSR. WhatsApp's link preview
// reads the static index.html OG tags (set in index.html) for the general
// storefront card; per-product cards would need SSR and are out of scope for
// this MVP. This hook still updates the live document for in-app navigation and
// for crawlers that execute JS.

type SeoInput = {
  title: string;
  description?: string;
  canonicalPath?: string;
  ogImageUrl?: string;
  jsonLd?: object;
};

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

const JSONLD_ID = "olivia-jsonld";

export function useSeo({ title, description, canonicalPath, ogImageUrl, jsonLd }: SeoInput) {
  useEffect(() => {
    document.title = title;
    const origin = window.location.origin;
    if (canonicalPath) upsertLink("canonical", origin + canonicalPath);
    if (description) {
      upsertMeta("name", "description", description);
      upsertMeta("property", "og:description", description);
      upsertMeta("name", "twitter:description", description);
    }
    upsertMeta("property", "og:title", title);
    upsertMeta("name", "twitter:title", title);
    upsertMeta("property", "og:type", "website");
    upsertMeta("name", "twitter:card", "summary_large_image");
    if (ogImageUrl) {
      upsertMeta("property", "og:image", ogImageUrl);
      upsertMeta("name", "twitter:image", ogImageUrl);
    }

    const existing = document.getElementById(JSONLD_ID);
    if (existing) existing.remove();
    if (jsonLd) {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.id = JSONLD_ID;
      script.textContent = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }
  }, [title, description, canonicalPath, ogImageUrl, JSON.stringify(jsonLd)]);
}
