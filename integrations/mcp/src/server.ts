import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ConfigError } from "./config.js";
import {
  findUIMaterialsInputSchema,
  findUIMaterialsOutputSchema,
  findUIReferencesInputSchema,
} from "./contracts.js";
import {
  MobbinAuthenticationRequiredError,
  MobbinConfigurationError,
  MobbinLockError,
  MobbinRefreshError,
} from "./auth/mobbin.js";
import { GoogleFontsProvider, GoogleFontsProviderError } from "./providers/google-fonts.js";
import { IconifyProvider, IconifyProviderError } from "./providers/iconify.js";
import { MobbinProvider, MobbinProviderError } from "./providers/mobbin.js";
import type { MaterialProvider, ReferenceProvider } from "./providers/types.js";

const rootPackage = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as { version?: unknown };
const rootVersion = rootPackage.version;
if (typeof rootVersion !== "string" || rootVersion.length === 0) {
  throw new Error("Root package version is missing.");
}
export const SERVER_VERSION = rootVersion;

const referenceProviderRegistry: Readonly<Record<string, ReferenceProvider>> = {
  mobbin: new MobbinProvider(),
};
const materialProviderRegistry: Readonly<Record<"font" | "icon", MaterialProvider>> = {
  font: new GoogleFontsProvider(),
  icon: new IconifyProvider(),
};

// Keep primitive validation in the SDK, then map only semantic field combinations to INVALID_INPUT.
const referenceToolInputSchema = z.object(findUIReferencesInputSchema.shape).strict();
const materialToolInputSchema = z.object({
  query: z.string().trim().min(1),
  kind: z.enum(["font", "icon"]),
  source: z.enum(["google-fonts", "iconify"]).optional(),
  limit: z.number().int().min(1).max(3).default(3),
  category: z.enum(["serif", "sans-serif", "monospace", "display", "handwriting"]).optional(),
  prefix: z.string().optional(),
}).strict();

export type WrapperErrorCode =
  | "AUTH_REQUIRED"
  | "CONFIG_REQUIRED"
  | "PROVIDER_ERROR"
  | "INVALID_INPUT";

type ProviderSource = "mobbin" | "google-fonts" | "iconify";

interface WrapperErrorPayload {
  code: WrapperErrorCode;
  source: ProviderSource;
  message: string;
}

interface WrapperErrorResult {
  [key: string]: unknown;
  isError: true;
  content: [{ type: "text"; text: string }];
  structuredContent: { error: WrapperErrorPayload };
}

function wrapperError(
  code: WrapperErrorCode,
  source: ProviderSource,
  message: string,
): WrapperErrorResult {
  const structuredContent = { error: { code, source, message } };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function providerFailure(error: unknown, source: ProviderSource) {
  if (error instanceof MobbinAuthenticationRequiredError) {
    return wrapperError("AUTH_REQUIRED", "mobbin", error.message);
  }
  if (error instanceof MobbinConfigurationError || error instanceof ConfigError) {
    return wrapperError("CONFIG_REQUIRED", source, "Provider credentials are not configured safely.");
  }
  if (error instanceof GoogleFontsProviderError && error.message.includes("API key is missing")) {
    return wrapperError(
      "CONFIG_REQUIRED",
      "google-fonts",
      "Google Fonts API key is missing. Run `ui-reference-mcp auth google-fonts`.",
    );
  }
  if (error instanceof MobbinLockError) {
    return wrapperError("PROVIDER_ERROR", "mobbin", "Mobbin credentials could not be updated safely.");
  }
  if (error instanceof MobbinRefreshError) {
    return wrapperError("PROVIDER_ERROR", "mobbin", "Mobbin authorization refresh failed.");
  }
  if (
    error instanceof MobbinProviderError ||
    error instanceof GoogleFontsProviderError ||
    error instanceof IconifyProviderError
  ) {
    return wrapperError("PROVIDER_ERROR", source, error.message);
  }
  return wrapperError("PROVIDER_ERROR", source, "The provider request failed.");
}

function sourceFromMaterialInput(input: unknown): ProviderSource {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "iconify";
  if ("source" in input) {
    const source = input.source;
    if (source === "google-fonts" || source === "iconify") return source;
  }
  if ("kind" in input) {
    return input.kind === "font" ? "google-fonts" : "iconify";
  }
  return "iconify";
}


export interface UIReferenceServer {
  server: McpServer;
  close(): Promise<void>;
}

export function createUIReferenceServer(): UIReferenceServer {
  const server = new McpServer({ name: "ui-reference-mcp", version: SERVER_VERSION });
  const mobbinProvider = referenceProviderRegistry.mobbin!;

  server.registerTool(
    "find_ui_references",
    {
      description: "Search native Mobbin screen, flow, and web-section references.",
      inputSchema: referenceToolInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const parsed = findUIReferencesInputSchema.safeParse(args);
      if (!parsed.success) {
        return wrapperError("INVALID_INPUT", "mobbin", "The reference search fields are not a supported combination.");
      }
      try {
        return await mobbinProvider.search(parsed.data);
      } catch (error) {
        return providerFailure(error, "mobbin");
      }
    },
  );

  server.registerTool(
    "find_ui_materials",
    {
      description: "Find real Google Fonts metadata or Iconify icon assets.",
      inputSchema: materialToolInputSchema,
      outputSchema: findUIMaterialsOutputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const parsed = findUIMaterialsInputSchema.safeParse(args);
      if (!parsed.success) {
        return wrapperError(
          "INVALID_INPUT",
          sourceFromMaterialInput(args),
          "The material source, kind, or optional fields are not a supported combination.",
        );
      }

      const input = parsed.data;
      const source = input.source;
      try {
        const provider = materialProviderRegistry[input.kind];
        const results = await provider.search(input);
        const validated = findUIMaterialsOutputSchema.parse({
          source,
          kind: input.kind,
          results,
        });
        return {
          structuredContent: validated,
          content: [{ type: "text", text: JSON.stringify(validated) }],
        };
      } catch (error) {
        return providerFailure(error, source);
      }
    },
  );

  return {
    server,
    async close() {
      await mobbinProvider.close();
    },
  };
}

/** Run the stdio-only server without writing human-readable content to stdout. */
export async function runStdioServer(): Promise<void> {
  const application = createUIReferenceServer();
  const transport = new StdioServerTransport();
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (): Promise<void> => {
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        process.stdin.off("end", onInputEnd);
        process.stdin.off("close", onInputEnd);
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        await application.server.close().catch(() => undefined);
        await application.close().catch(() => undefined);
        process.stdin.pause();
        process.stdin.destroy();
      })();
    }
    return shutdownPromise;
  };
  const onInputEnd = (): void => {
    void shutdown();
  };
  const onSignal = (): void => {
    void shutdown();
  };

  process.stdin.once("end", onInputEnd);
  process.stdin.once("close", onInputEnd);
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    await application.server.connect(transport);
  } catch (error) {
    await shutdown();
    throw error;
  }
}
