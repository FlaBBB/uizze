import assert from "node:assert/strict";
import test from "node:test";

import { findUIMaterialsInputSchema } from "../dist/contracts.js";
import { GoogleFontsProvider, GoogleFontsProviderError } from "../dist/providers/google-fonts.js";
import { IconifyProvider, IconifyProviderError } from "../dist/providers/iconify.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const catalog = {
  kind: "webfonts#webfontList",
  items: [
    {
      family: "Roboto Condensed",
      category: "sans-serif",
      variants: ["regular"],
      subsets: ["latin"],
      files: { regular: "https://fonts.gstatic.com/roboto-condensed.ttf" },
    },
    {
      family: "Roboto",
      category: "sans-serif",
      variants: ["regular", "700"],
      subsets: ["latin", "latin-ext"],
      files: { regular: "http://fonts.gstatic.com/roboto.ttf" },
    },
    {
      family: "Roboto Serif",
      category: "serif",
      variants: ["regular"],
      subsets: ["latin"],
      files: { regular: "https://fonts.gstatic.com/roboto-serif.ttf" },
    },
  ],
};

function googleProvider({ items = catalog.items, status = 200, payload, onRequest } = {}) {
  let fetches = 0;
  const provider = new GoogleFontsProvider({
    getApiKey: async () => "fixture-key",
    fetch: async (input) => {
      fetches += 1;
      const url = new URL(String(input));
      onRequest?.(url);
      if (payload !== undefined) return jsonResponse(payload, status);
      return jsonResponse({ kind: "webfonts#webfontList", items }, status);
    },
  });
  return { provider, fetchCount: () => fetches };
}

test("Google Fonts uses the documented endpoint and prefers the exact family", async () => {
  let seen;
  const { provider } = googleProvider({ onRequest: (url) => { seen = url; } });
  const results = await provider.search(findUIMaterialsInputSchema.parse({ query: "Roboto", kind: "font", limit: 1 }));

  assert.equal(seen.origin + seen.pathname, "https://www.googleapis.com/webfonts/v1/webfonts");
  assert.equal(seen.searchParams.get("key"), "fixture-key");
  assert.equal(seen.searchParams.get("sort"), "popularity");
  assert.equal(seen.searchParams.has("query"), false);
  assert.equal(seen.searchParams.has("limit"), false);
  assert.equal(results.length, 1);
  assert.equal(results[0].family, "Roboto");
  assert.equal(results[0].id, "Roboto");
  assert.deepEqual(results[0].variants, ["regular", "700"]);
  assert.equal(results[0].files.regular, "https://fonts.gstatic.com/roboto.ttf");
  assert.equal(results[0].source_url, "https://fonts.google.com/specimen/Roboto");
  assert.match(results[0].css_url, /^https:\/\/fonts\.googleapis\.com\/css2\?family=Roboto&display=swap$/);
  assert.equal("license" in results[0], false);
});

test("Google Fonts caches one successful catalog load per process", async () => {
  const { provider, fetchCount } = googleProvider();
  await provider.search(findUIMaterialsInputSchema.parse({ query: "Roboto", kind: "font" }));
  await provider.search(findUIMaterialsInputSchema.parse({ query: "Roboto Serif", kind: "font" }));
  assert.equal(fetchCount(), 1);
});

test("Google Fonts filters by category, honors limit, and reports no-match as empty", async () => {
  const { provider } = googleProvider();
  const serif = await provider.search(findUIMaterialsInputSchema.parse({ query: "Roboto", kind: "font", category: "serif" }));
  assert.deepEqual(serif.map((font) => font.family), ["Roboto Serif"]);

  const bounded = await provider.search(findUIMaterialsInputSchema.parse({ query: "Roboto", kind: "font", limit: 2 }));
  assert.deepEqual(bounded.map((font) => font.family), ["Roboto", "Roboto Condensed"]);

  const none = await provider.search(findUIMaterialsInputSchema.parse({ query: "zzqxnonexistent", kind: "font" }));
  assert.deepEqual(none, []);
});

test("Google Fonts rejects a non-gstatic asset host and malformed catalogs", async () => {
  const { provider: foreign } = googleProvider({
    items: [{
      family: "Roboto",
      category: "sans-serif",
      variants: ["regular"],
      subsets: ["latin"],
      files: { regular: "https://example.com/roboto.ttf" },
    }],
  });
  await assert.rejects(
    () => foreign.search(findUIMaterialsInputSchema.parse({ query: "Roboto", kind: "font" })),
    GoogleFontsProviderError,
  );

  const { provider: malformed } = googleProvider({ payload: { kind: "other#kind", items: [] } });
  await assert.rejects(
    () => malformed.search(findUIMaterialsInputSchema.parse({ query: "Roboto", kind: "font" })),
    GoogleFontsProviderError,
  );

  const { provider: failing } = googleProvider({ status: 403 });
  await assert.rejects(
    () => failing.search(findUIMaterialsInputSchema.parse({ query: "Roboto", kind: "font" })),
    GoogleFontsProviderError,
  );
});

test("Google Fonts reports a missing key as a configuration error, not an empty result", async () => {
  const provider = new GoogleFontsProvider({ getApiKey: async () => undefined, fetch: async () => jsonResponse(catalog) });
  await assert.rejects(
    () => provider.search(findUIMaterialsInputSchema.parse({ query: "Roboto", kind: "font" })),
    /auth google-fonts/,
  );
});

const iconifyPayload = {
  icons: ["lucide:credit-card", "lucide:credit-card", "lucide:credit-card-off", "lucide:check"],
  collections: {
    lucide: {
      name: "Lucide",
      author: { name: "Lucide Contributors", url: "https://github.com/lucide-icons/lucide" },
      license: { title: "ISC", spdx: "ISC", url: "https://github.com/lucide-icons/lucide/blob/main/LICENSE" },
    },
  },
};

test("Iconify requests the upstream minimum, dedupes, and keeps real license metadata", async () => {
  let seen;
  const provider = new IconifyProvider({
    fetch: async (input) => {
      seen = new URL(String(input));
      return jsonResponse(iconifyPayload);
    },
  });
  const results = await provider.search(
    findUIMaterialsInputSchema.parse({ query: "credit card", kind: "icon", prefix: "lucide", limit: 2 }),
  );

  assert.equal(seen.origin + seen.pathname, "https://api.iconify.design/search");
  assert.equal(seen.searchParams.get("query"), "credit card");
  assert.equal(seen.searchParams.get("limit"), "32");
  assert.equal(seen.searchParams.get("prefix"), "lucide");
  assert.deepEqual(results.map((icon) => icon.id), ["lucide:credit-card", "lucide:credit-card-off"]);
  assert.equal(results[0].collection, "Lucide");
  assert.equal(results[0].asset_url, "https://api.iconify.design/lucide/credit-card.svg");
  assert.equal(results[0].source_url, "https://icon-sets.iconify.design/lucide/credit-card/");
  assert.deepEqual(results[0].license, { title: "ISC", spdx: "ISC", url: "https://github.com/lucide-icons/lucide/blob/main/LICENSE" });
  assert.equal(results[0].author.name, "Lucide Contributors");
});

test("Iconify reports an empty match as success and errors for unsafe or inconsistent payloads", async () => {
  const empty = new IconifyProvider({
    fetch: async () => jsonResponse({ icons: [], collections: {} }),
  });
  assert.deepEqual(
    await empty.search(findUIMaterialsInputSchema.parse({ query: "zzqxnonexistent", kind: "icon" })),
    [],
  );

  const unsafe = new IconifyProvider({ fetch: async () => jsonResponse({ icons: ["../../etc:passwd"], collections: {} }) });
  await assert.rejects(
    () => unsafe.search(findUIMaterialsInputSchema.parse({ query: "x", kind: "icon" })),
    IconifyProviderError,
  );

  const missingMetadata = new IconifyProvider({ fetch: async () => jsonResponse({ icons: ["lucide:check"], collections: {} }) });
  await assert.rejects(
    () => missingMetadata.search(findUIMaterialsInputSchema.parse({ query: "x", kind: "icon" })),
    IconifyProviderError,
  );

  const outsidePrefix = new IconifyProvider({
    fetch: async () => jsonResponse({ icons: ["mdi:home"], collections: { mdi: { name: "Material" } } }),
  });
  await assert.rejects(
    () => outsidePrefix.search(findUIMaterialsInputSchema.parse({ query: "x", kind: "icon", prefix: "lucide" })),
    IconifyProviderError,
  );

  const failing = new IconifyProvider({ fetch: async () => jsonResponse({}, 500) });
  await assert.rejects(
    () => failing.search(findUIMaterialsInputSchema.parse({ query: "x", kind: "icon" })),
    IconifyProviderError,
  );
});

test("providers refuse a search that does not match their own source and kind", async () => {
  const { provider: google } = googleProvider();
  await assert.rejects(
    () => google.search({ query: "x", kind: "icon", source: "iconify", limit: 1 }),
    GoogleFontsProviderError,
  );

  const iconify = new IconifyProvider({ fetch: async () => jsonResponse(iconifyPayload) });
  await assert.rejects(
    () => iconify.search({ query: "x", kind: "font", source: "google-fonts", limit: 1 }),
    IconifyProviderError,
  );
});
