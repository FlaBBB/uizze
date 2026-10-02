import { z } from "zod";
import type { FontMaterial, MaterialInput } from "../contracts.js";
import { getGoogleFontsApiKey } from "../config.js";
import type { MaterialProvider } from "./types.js";

const GOOGLE_FONTS_ENDPOINT = "https://www.googleapis.com/webfonts/v1/webfonts";
const REQUEST_TIMEOUT_MS = 30_000;

const googleFontSchema = z.object({
  family: z.string().min(1),
  category: z.string().min(1),
  variants: z.array(z.string()),
  subsets: z.array(z.string()),
  files: z.record(z.string(), z.string()),
});

const googleCatalogSchema = z.object({
  kind: z.literal("webfonts#webfontList"),
  items: z.array(googleFontSchema),
});

type GoogleFont = z.infer<typeof googleFontSchema>;
type CatalogEntry = {
  font: GoogleFont;
  normalizedFamily: string;
  normalizedSearchText: string;
};

let catalogPromise: Promise<CatalogEntry[]> | undefined;
let catalogApiKey: string | undefined;
let catalogFetch: typeof fetch | undefined;

export class GoogleFontsProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GoogleFontsProviderError";
  }
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\p{P}\s]+/gu, " ").trim().replace(/\s+/g, " ");
}

async function fetchCatalog(apiKey: string, fetchImpl: typeof fetch): Promise<CatalogEntry[]> {
  const url = new URL(GOOGLE_FONTS_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("sort", "popularity");

  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new GoogleFontsProviderError("Google Fonts catalog request failed.", { cause: error });
  }
  if (!response.ok) {
    throw new GoogleFontsProviderError(`Google Fonts catalog returned HTTP ${response.status}.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new GoogleFontsProviderError("Google Fonts returned invalid JSON.", { cause: error });
  }
  const parsed = googleCatalogSchema.safeParse(payload);
  if (!parsed.success) {
    throw new GoogleFontsProviderError("Google Fonts returned an invalid catalog response.", {
      cause: parsed.error,
    });
  }

  return parsed.data.items.map((font) => ({
    font,
    normalizedFamily: normalize(font.family),
    normalizedSearchText: ` ${normalize(`${font.family} ${font.category}`)} `,
  }));
}

function loadCatalog(apiKey: string, fetchImpl: typeof fetch): Promise<CatalogEntry[]> {
  if (catalogPromise && catalogApiKey === apiKey && catalogFetch === fetchImpl) {
    return catalogPromise;
  }

  const pending = fetchCatalog(apiKey, fetchImpl);
  catalogPromise = pending;
  catalogApiKey = apiKey;
  catalogFetch = fetchImpl;

  void pending.catch(() => {
    if (catalogPromise === pending) {
      catalogPromise = undefined;
      catalogApiKey = undefined;
      catalogFetch = undefined;
    }
  });
  return pending;
}

function specimenUrl(family: string): string {
  const encoded = encodeURIComponent(family)
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `https://fonts.google.com/specimen/${encoded}`;
}

function cssUrl(family: string): string {
  const query = new URLSearchParams();
  query.set("family", family);
  query.set("display", "swap");
  return `https://fonts.googleapis.com/css2?${query.toString()}`;
}

function secureFontFiles(files: Record<string, string>): Record<string, string> {
  const secureFiles: Record<string, string> = {};
  for (const [variant, rawUrl] of Object.entries(files)) {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch (error) {
      throw new GoogleFontsProviderError("Google Fonts returned an invalid font file URL.", {
        cause: error,
      });
    }

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.hostname !== "fonts.gstatic.com" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      throw new GoogleFontsProviderError("Google Fonts returned a file outside fonts.gstatic.com.");
    }
    url.protocol = "https:";
    secureFiles[variant] = url.toString();
  }
  return secureFiles;
}

function materialFor(entry: CatalogEntry): FontMaterial {
  const font = entry.font;
  return {
    id: font.family,
    family: font.family,
    category: font.category,
    variants: font.variants,
    subsets: font.subsets,
    source_url: specimenUrl(font.family),
    css_url: cssUrl(font.family),
    files: secureFontFiles(font.files),
  };
}

export interface GoogleFontsProviderOptions {
  fetch?: typeof fetch;
  getApiKey?: () => Promise<string | undefined>;
}

export class GoogleFontsProvider implements MaterialProvider {
  readonly id = "google-fonts";
  readonly kind = "font" as const;
  private readonly fetchImpl: typeof fetch;
  private readonly getApiKey: () => Promise<string | undefined>;

  constructor(options: GoogleFontsProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.getApiKey = options.getApiKey ?? getGoogleFontsApiKey;
  }

  async search(input: MaterialInput): Promise<FontMaterial[]> {
    if (input.kind !== "font" || input.source !== "google-fonts") {
      throw new GoogleFontsProviderError("Google Fonts provider received an incompatible search.");
    }

    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new GoogleFontsProviderError(
        "Google Fonts API key is missing. Run `ui-reference-mcp auth google-fonts`.",
      );
    }

    const catalog = await loadCatalog(apiKey, this.fetchImpl);
    const query = normalize(input.query);
    const tokenNeedles = query.split(" ").filter(Boolean).map((token) => ` ${token} `);
    if (tokenNeedles.length === 0) return [];
    const matching: CatalogEntry[][] = [[], [], []];

    for (const entry of catalog) {
      if (input.category !== undefined && entry.font.category !== input.category) continue;
      let containsEveryToken = true;
      for (const needle of tokenNeedles) {
        if (!entry.normalizedSearchText.includes(needle)) {
          containsEveryToken = false;
          break;
        }
      }
      if (!containsEveryToken) continue;

      const priority = entry.normalizedFamily === query
        ? 0
        : entry.normalizedFamily.startsWith(query)
          ? 1
          : 2;
      const bucket = matching[priority]!;
      if (bucket.length < input.limit) bucket.push(entry);
    }

    const selected: CatalogEntry[] = [];
    for (const bucket of matching) {
      for (const entry of bucket) {
        selected.push(entry);
        if (selected.length === input.limit) return selected.map(materialFor);
      }
    }
    return selected.map(materialFor);
  }
}
