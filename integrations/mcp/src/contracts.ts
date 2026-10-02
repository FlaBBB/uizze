import { z } from "zod";

const nonemptyQuery = z.string().trim().min(1, "Query must not be empty.");
const resultLimit = z.number().int().min(1).max(3).default(3);

export const findUIReferencesInputSchema = z
  .object({
    query: nonemptyQuery,
    platform: z.enum(["ios", "web"]),
    kind: z.enum(["screen", "flow", "section"]).default("screen"),
    source: z.literal("mobbin").default("mobbin"),
    limit: resultLimit,
    mode: z.enum(["standard", "deep"]).optional(),
    task_intent: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.kind === "section" && input.platform === "ios") {
      context.addIssue({
        code: "custom",
        path: ["platform"],
        message: "Section references are available only for the web platform.",
      });
    }

    if (input.mode !== undefined && input.kind !== "screen") {
      context.addIssue({
        code: "custom",
        path: ["mode"],
        message: "Mode is supported only for screen references.",
      });
    }
  });

export type ReferenceInput = z.infer<typeof findUIReferencesInputSchema>;

const iconSetPrefix = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const fontMaterialInputSchema = z
  .object({
    query: nonemptyQuery,
    kind: z.literal("font"),
    source: z.literal("google-fonts").default("google-fonts"),
    limit: resultLimit,
    category: z
      .enum(["serif", "sans-serif", "monospace", "display", "handwriting"])
      .optional(),
    prefix: z.string().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.prefix !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["prefix"],
        message: "Prefix is supported only for icon searches.",
      });
    }
  });

const iconMaterialInputSchema = z
  .object({
    query: nonemptyQuery,
    kind: z.literal("icon"),
    source: z.literal("iconify").default("iconify"),
    limit: resultLimit,
    category: z
      .enum(["serif", "sans-serif", "monospace", "display", "handwriting"])
      .optional(),
    prefix: z.string().regex(iconSetPrefix, "Prefix must be a lowercase icon-set slug.").optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.category !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["category"],
        message: "Category is supported only for font searches.",
      });
    }
  });

export const findUIMaterialsInputSchema = z.union([
  fontMaterialInputSchema,
  iconMaterialInputSchema,
]);

export type MaterialInput = z.infer<typeof findUIMaterialsInputSchema>;

export const fontMaterialSchema = z
  .object({
    id: z.string().min(1),
    family: z.string().min(1),
    category: z.string().min(1),
    variants: z.array(z.string()),
    subsets: z.array(z.string()),
    source_url: z.string().url(),
    css_url: z.string().url(),
    files: z.record(z.string(), z.string().url()),
  })
  .strict();

export const iconMaterialSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    collection: z.string().min(1),
    source_url: z.string().url(),
    asset_url: z.string().url(),
    author: z
      .object({
        name: z.string().min(1),
        url: z.string().url().optional(),
      })
      .strict()
      .optional(),
    license: z
      .object({
        title: z.string().min(1),
        spdx: z.string().min(1).optional(),
        url: z.string().url().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type FontMaterial = z.infer<typeof fontMaterialSchema>;
export type IconMaterial = z.infer<typeof iconMaterialSchema>;

const materialItemSchema = z.union([fontMaterialSchema, iconMaterialSchema]);

/**
 * The root remains a Zod object for SDK output-schema support. This refinement
 * couples the source, kind, and item shape at runtime.
 */
export const findUIMaterialsOutputSchema = z
  .object({
    source: z.enum(["google-fonts", "iconify"]).optional(),
    kind: z.enum(["font", "icon"]).optional(),
    results: z.array(materialItemSchema).optional(),
    error: z
      .object({
        code: z.enum(["AUTH_REQUIRED", "CONFIG_REQUIRED", "PROVIDER_ERROR", "INVALID_INPUT"]),
        source: z.enum(["mobbin", "google-fonts", "iconify"]),
        message: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.error !== undefined) {
      if (result.source !== undefined || result.kind !== undefined || result.results !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["error"],
          message: "Error results cannot contain material result fields.",
        });
      }
      return;
    }

    if (result.source === undefined || result.kind === undefined || result.results === undefined) {
      context.addIssue({
        code: "custom",
        message: "Successful material results require source, kind, and results.",
      });
      return;
    }

    const expectsFonts = result.source === "google-fonts" && result.kind === "font";
    const expectsIcons = result.source === "iconify" && result.kind === "icon";

    if (!expectsFonts && !expectsIcons) {
      context.addIssue({
        code: "custom",
        path: ["kind"],
        message: "Material source and kind do not match.",
      });
      return;
    }

    result.results.forEach((item, index) => {
      const isFont = "family" in item;
      if ((expectsFonts && !isFont) || (expectsIcons && isFont)) {
        context.addIssue({
          code: "custom",
          path: ["results", index],
          message: "Material item does not match the selected source and kind.",
        });
      }
    });
  });

export type FindUIMaterialsResult =
  | { source: "google-fonts"; kind: "font"; results: FontMaterial[] }
  | { source: "iconify"; kind: "icon"; results: IconMaterial[] };
