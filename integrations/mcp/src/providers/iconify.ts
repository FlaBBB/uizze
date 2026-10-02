import { z } from "zod";
import type { IconMaterial, MaterialInput } from "../contracts.js";
import type { MaterialProvider } from "./types.js";

const ICONIFY_ENDPOINT = "https://api.iconify.design/search";
const ICONIFY_SOURCE = "https://icon-sets.iconify.design";
const ICONIFY_ASSET = "https://api.iconify.design";
const UPSTREAM_LIMIT = 32;
const REQUEST_TIMEOUT_MS = 30_000;
const safeSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const collectionSchema = z.object({
  name: z.string().min(1),
  author: z.object({
    name: z.string().min(1),
    url: z.string().url().optional(),
  }).passthrough().optional(),
  license: z.object({
    title: z.string().min(1),
    spdx: z.string().min(1).optional(),
    url: z.string().url().optional(),
  }).passthrough().optional(),
}).passthrough();

const iconifyResponseSchema = z.object({
  icons: z.array(z.string()),
  collections: z.record(z.string(), collectionSchema),
}).passthrough();

type IconifyCollection = z.infer<typeof collectionSchema>;

export class IconifyProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IconifyProviderError";
  }
}

function parseSafeId(id: string): { prefix: string; name: string } {
  const separator = id.indexOf(":");
  if (separator < 0 || id.indexOf(":", separator + 1) !== -1) {
    throw new IconifyProviderError("Iconify returned an invalid icon ID.");
  }
  const prefix = id.slice(0, separator);
  const name = id.slice(separator + 1);
  if (!safeSlug.test(prefix) || !safeSlug.test(name)) {
    throw new IconifyProviderError("Iconify returned an unsafe icon ID.");
  }
  return { prefix, name };
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

function materialFor(id: string, collection: IconifyCollection): IconMaterial {
  const { prefix, name } = parseSafeId(id);
  const result: IconMaterial = {
    id,
    name,
    collection: collection.name,
    source_url: `${ICONIFY_SOURCE}/${encodeSegment(prefix)}/${encodeSegment(name)}/`,
    asset_url: `${ICONIFY_ASSET}/${encodeSegment(prefix)}/${encodeSegment(name)}.svg`,
  };
  if (collection.author) {
    result.author = collection.author.url
      ? { name: collection.author.name, url: collection.author.url }
      : { name: collection.author.name };
  }
  if (collection.license) {
    result.license = {
      title: collection.license.title,
      ...(collection.license.spdx ? { spdx: collection.license.spdx } : {}),
      ...(collection.license.url ? { url: collection.license.url } : {}),
    };
  }
  return result;
}

export interface IconifyProviderOptions {
  fetch?: typeof fetch;
}

export class IconifyProvider implements MaterialProvider {
  readonly id = "iconify";
  readonly kind = "icon" as const;
  private readonly fetchImpl: typeof fetch;

  constructor(options: IconifyProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async search(input: MaterialInput): Promise<IconMaterial[]> {
    if (input.kind !== "icon" || input.source !== "iconify") {
      throw new IconifyProviderError("Iconify provider received an incompatible search.");
    }

    const url = new URL(ICONIFY_ENDPOINT);
    url.searchParams.set("query", input.query);
    url.searchParams.set("limit", String(UPSTREAM_LIMIT));
    if (input.prefix !== undefined) url.searchParams.set("prefix", input.prefix);

    let response: Response;
    try {
      response = await this.fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      throw new IconifyProviderError("Iconify search request failed.", { cause: error });
    }
    if (!response.ok) {
      throw new IconifyProviderError(`Iconify search returned HTTP ${response.status}.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new IconifyProviderError("Iconify returned invalid JSON.", { cause: error });
    }
    const parsed = iconifyResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new IconifyProviderError("Iconify returned an invalid search response.", {
        cause: parsed.error,
      });
    }

    const selected: IconMaterial[] = [];
    const seen = new Set<string>();
    for (const id of parsed.data.icons) {
      if (selected.length === input.limit) break;
      const { prefix } = parseSafeId(id);
      if (input.prefix !== undefined && prefix !== input.prefix) {
        throw new IconifyProviderError("Iconify returned an icon outside the requested prefix.");
      }
      if (seen.has(id)) continue;
      seen.add(id);

      const collection = parsed.data.collections[prefix];
      if (!collection) {
        throw new IconifyProviderError("Iconify omitted collection metadata for a returned icon.");
      }
      selected.push(materialFor(id, collection));
    }
    return selected;
  }
}
