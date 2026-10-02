import assert from "node:assert/strict";
import test from "node:test";

import {
  findUIMaterialsInputSchema,
  findUIMaterialsOutputSchema,
  findUIReferencesInputSchema,
} from "../dist/contracts.js";

test("reference input applies documented defaults", () => {
  const input = findUIReferencesInputSchema.parse({ query: "  billing settings  ", platform: "web" });
  assert.deepEqual(input, {
    query: "billing settings",
    platform: "web",
    kind: "screen",
    source: "mobbin",
    limit: 3,
  });
});

test("reference input rejects unsupported combinations and fields", () => {
  assert.throws(() => findUIReferencesInputSchema.parse({ query: "pricing", platform: "ios", kind: "section" }));
  assert.throws(() => findUIReferencesInputSchema.parse({ query: "onboarding", platform: "ios", kind: "flow", mode: "deep" }));
  assert.throws(() => findUIReferencesInputSchema.parse({ query: "pricing", platform: "web", kind: "section", mode: "standard" }));
  assert.throws(() => findUIReferencesInputSchema.parse({ query: "  ", platform: "web" }));
  assert.throws(() => findUIReferencesInputSchema.parse({ query: "x", platform: "web", limit: 0 }));
  assert.throws(() => findUIReferencesInputSchema.parse({ query: "x", platform: "web", limit: 4 }));
  assert.throws(() => findUIReferencesInputSchema.parse({ query: "x", platform: "web", limit: 1.5 }));
  assert.throws(() => findUIReferencesInputSchema.parse({ query: "x", platform: "web", kind: "pack" }));
  assert.throws(() => findUIReferencesInputSchema.parse({ query: "x", platform: "web", selectedId: "123" }));
  assert.throws(() => findUIReferencesInputSchema.parse({ query: "x", platform: "web", userConfirmed: true }));
  assert.throws(() => findUIReferencesInputSchema.parse({ query: "x", platform: "android" }));
  assert.throws(() => findUIReferencesInputSchema.parse({ query: "x", platform: "web", task_intent: "   " }));
});

test("material input derives the source from the kind and rejects mismatches", () => {
  assert.equal(findUIMaterialsInputSchema.parse({ query: "Roboto", kind: "font" }).source, "google-fonts");
  assert.equal(findUIMaterialsInputSchema.parse({ query: "credit card", kind: "icon" }).source, "iconify");
  assert.throws(() => findUIMaterialsInputSchema.parse({ query: "Roboto", kind: "font", source: "iconify" }));
  assert.throws(() => findUIMaterialsInputSchema.parse({ query: "credit card", kind: "icon", source: "google-fonts" }));
  assert.throws(() => findUIMaterialsInputSchema.parse({ query: "credit card", kind: "icon", category: "serif" }));
  assert.throws(() => findUIMaterialsInputSchema.parse({ query: "Roboto", kind: "font", prefix: "lucide" }));
  assert.throws(() => findUIMaterialsInputSchema.parse({ query: "credit card", kind: "icon", prefix: "../lucide" }));
  assert.throws(() => findUIMaterialsInputSchema.parse({ query: "credit card", kind: "icon", prefix: "Lucide" }));
  assert.throws(() => findUIMaterialsInputSchema.parse({ query: "Roboto", kind: "animation" }));
  assert.throws(() => findUIMaterialsInputSchema.parse({ query: "Roboto", kind: "font", limit: 0 }));
});

const fontResult = {
  id: "Roboto",
  family: "Roboto",
  category: "sans-serif",
  variants: ["regular"],
  subsets: ["latin"],
  source_url: "https://fonts.google.com/specimen/Roboto",
  css_url: "https://fonts.googleapis.com/css2?family=Roboto&display=swap",
  files: { regular: "https://fonts.gstatic.com/s/roboto/regular.ttf" },
};

const iconResult = {
  id: "lucide:credit-card",
  name: "credit-card",
  collection: "Lucide",
  source_url: "https://icon-sets.iconify.design/lucide/credit-card/",
  asset_url: "https://api.iconify.design/lucide/credit-card.svg",
  license: { title: "ISC", spdx: "ISC" },
};

test("material output schema accepts only source-consistent results", () => {
  assert.equal(findUIMaterialsOutputSchema.safeParse({ source: "google-fonts", kind: "font", results: [fontResult] }).success, true);
  assert.equal(findUIMaterialsOutputSchema.safeParse({ source: "iconify", kind: "icon", results: [iconResult] }).success, true);
  assert.equal(findUIMaterialsOutputSchema.safeParse({ source: "google-fonts", kind: "font", results: [] }).success, true);
  assert.equal(findUIMaterialsOutputSchema.safeParse({ source: "iconify", kind: "font", results: [] }).success, false);
  assert.equal(findUIMaterialsOutputSchema.safeParse({ source: "iconify", kind: "icon", results: [fontResult] }).success, false);
  assert.equal(findUIMaterialsOutputSchema.safeParse({ source: "google-fonts", kind: "font", results: [iconResult] }).success, false);
  assert.equal(findUIMaterialsOutputSchema.safeParse({ results: [] }).success, false);
  assert.equal(findUIMaterialsOutputSchema.safeParse({ source: "google-fonts", kind: "font", results: [], extra: true }).success, false);
});

test("material output schema accepts wrapper error payloads without result fields", () => {
  const error = { code: "CONFIG_REQUIRED", source: "google-fonts", message: "Google Fonts API key is missing." };
  assert.equal(findUIMaterialsOutputSchema.safeParse({ error }).success, true);
  assert.equal(findUIMaterialsOutputSchema.safeParse({ error, results: [] }).success, false);
  assert.equal(findUIMaterialsOutputSchema.safeParse({ error: { ...error, code: "NOPE" } }).success, false);
  assert.equal(findUIMaterialsOutputSchema.safeParse({ error: { ...error, message: "" } }).success, false);
});
