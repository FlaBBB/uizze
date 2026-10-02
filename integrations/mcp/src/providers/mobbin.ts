import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { MobbinCredentialBundle } from "../auth/mobbin.js";
import {
  MobbinAuthenticationRequiredError,
  MobbinConfigurationError,
  MobbinLockError,
  MobbinRefreshError,
  refreshMobbinBundleAfterUnauthorized,
  readMobbinBundle,
} from "../auth/mobbin.js";
import type { ReferenceInput } from "../contracts.js";
import type { ReferenceProvider } from "./types.js";

const MCP_CALL_TIMEOUT_MS = 180_000;
const MCP_LIST_TIMEOUT_MS = 30_000;
const REQUIRED_TOOL_ARGUMENTS = {
  search_screens: ["query", "platform", "limit", "image_format", "mode", "task_intent"],
  search_flows: ["query", "platform", "limit", "image_format", "task_intent"],
  search_sections: ["query", "limit", "image_format", "task_intent"],
} as const;

export class MobbinProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MobbinProviderError";
  }
}

export class MobbinUnauthorizedError extends Error {
  readonly accessToken: string;

  constructor(accessToken: string) {
    super("Mobbin access token was rejected.");
    this.name = "MobbinUnauthorizedError";
    this.accessToken = accessToken;
  }
}
function propertySupportsValues(property: object, expectedValues: string[]): boolean {
  if (!("enum" in property)) return true;
  const allowedValues = property.enum;
  return Array.isArray(allowedValues) && expectedValues.every((value) => allowedValues.includes(value));
}

export interface MobbinClientConnection {
  client: Client;
  transport: StreamableHTTPClientTransport;
  accessToken: string;
  activeCalls: number;
  closeWhenIdle: boolean;
  closed: boolean;
}

function clientForAccessToken(accessToken: string): MobbinClientConnection {
  const transport = new StreamableHTTPClientTransport(
    new URL("https://api.mobbin.com/mcp"),
    { requestInit: { headers: { Authorization: `Bearer ${accessToken}` } } },
  );
  const client = new Client({ name: "ui-reference-mcp", version: "1.0.0" });
  return {
    client,
    transport,
    accessToken,
    activeCalls: 0,
    closeWhenIdle: false,
    closed: false,
  };
}

/** Check the authenticated native tool surface and every argument key our adapter sends. */
export async function validateMobbinToolList(client: Client): Promise<void> {
  const response = await client.listTools(undefined, { timeout: MCP_LIST_TIMEOUT_MS });
  const tools = new Map<string, typeof response.tools[number]>();
  for (const tool of response.tools) {
    tools.set(tool.name, tool);
  }

  for (const [name, argumentNames] of Object.entries(REQUIRED_TOOL_ARGUMENTS)) {
    const tool = tools.get(name);
    const properties = tool?.inputSchema.properties;
    if (!tool || !properties || typeof properties !== "object") {
      throw new MobbinProviderError("The authenticated Mobbin native tool contract is unavailable.");
    }

    for (const argumentName of argumentNames) {
      if (!Object.hasOwn(properties, argumentName)) {
        throw new MobbinProviderError("The authenticated Mobbin native tool schema is incompatible.");
      }
    }

    const required = new Set(tool.inputSchema.required ?? []);
    if (required.has("task_intent")) {
      throw new MobbinProviderError("The authenticated Mobbin native tool schema is incompatible.");
    }

    if (name !== "search_sections" && !propertySupportsValues(properties.platform, ["ios", "web"])) {
      throw new MobbinProviderError("The authenticated Mobbin platform schema is incompatible.");
    }
    if (!propertySupportsValues(properties.image_format, ["jpg"])) {
      throw new MobbinProviderError("The authenticated Mobbin image schema is incompatible.");
    }
    if (name === "search_screens" && !propertySupportsValues(properties.mode, ["standard", "deep"])) {
      throw new MobbinProviderError("The authenticated Mobbin screen-mode schema is incompatible.");
    }
  }
}

export async function createMobbinClientConnection(
  bundle: MobbinCredentialBundle,
): Promise<MobbinClientConnection> {
  const connection = clientForAccessToken(bundle.tokens.access_token);
  try {
    await connection.client.connect(connection.transport, { timeout: MCP_LIST_TIMEOUT_MS });
    await validateMobbinToolList(connection.client);
    return connection;
  } catch (error) {
    await closeMobbinClientConnection(connection);
    if (isUnauthorized(error)) {
      throw new MobbinUnauthorizedError(bundle.tokens.access_token);
    }
    throw error;
  }
}

export async function closeMobbinClientConnection(connection: MobbinClientConnection): Promise<void> {
  if (connection.closed) return;
  connection.closed = true;
  await connection.client.close().catch(() => undefined);
}

function isUnauthorized(error: unknown): error is StreamableHTTPError {
  return error instanceof StreamableHTTPError && error.code === 401;
}

function safeNativeErrorMessage(result: CallToolResult): string {
  let text: string | undefined;
  for (const block of result.content) {
    if (block.type === "text" && block.text.trim().length > 0) {
      text = block.text.trim();
      break;
    }
  }
  if (!text || text.length > 500) return "Mobbin search failed.";

  const sensitive = /(?:authorization\s*:\s*bearer|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|authorization[_ -]?code|(?:[?&]|\b)(?:code|state|token)=\S+)/i;
  const jwtLike = /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}(?:\.[a-zA-Z0-9_-]+)?\b/;
  const stackTrace = /(?:^|\n)\s*at\s+[^\n]+\([^\n]+:\d+:\d+\)/;
  const html = /<\s*(?:!doctype|html|body)\b/i;
  if (sensitive.test(text) || jwtLike.test(text) || stackTrace.test(text) || html.test(text)) {
    return "Mobbin search failed.";
  }
  return text;
}

function stripUpstreamMetadata(result: CallToolResult): CallToolResult {
  if (result.isError) {
    return {
      isError: true,
      content: [{ type: "text", text: safeNativeErrorMessage(result) }],
    };
  }

  const content = result.content.flatMap((block) => {
    if (
      (block.type === "resource" || block.type === "resource_link") &&
      "uri" in block && typeof block.uri === "string" && block.uri.startsWith("ui://")
    ) {
      return [];
    }
    const { _meta: omittedMetadata, ...cleanBlock } = block;
    void omittedMetadata;
    return [cleanBlock as typeof block];
  });
  const { _meta: omittedMetadata, ...cleanResult } = result;
  void omittedMetadata;
  return { ...cleanResult, content } as CallToolResult;
}

function nativeCall(input: ReferenceInput): { name: string; arguments: Record<string, unknown> } {
  const taskIntent = input.task_intent === undefined ? {} : { task_intent: input.task_intent };
  if (input.kind === "screen") {
    return {
      name: "search_screens",
      arguments: {
        query: input.query,
        platform: input.platform,
        limit: input.limit,
        image_format: "jpg",
        mode: input.mode ?? "standard",
        ...taskIntent,
      },
    };
  }
  if (input.kind === "flow") {
    return {
      name: "search_flows",
      arguments: {
        query: input.query,
        platform: input.platform,
        limit: input.limit,
        image_format: "jpg",
        ...taskIntent,
      },
    };
  }
  return {
    name: "search_sections",
    arguments: {
      query: input.query,
      limit: input.limit,
      image_format: "jpg",
      ...taskIntent,
    },
  };
}

export class MobbinProvider implements ReferenceProvider {
  readonly id = "mobbin";
  private connection: MobbinClientConnection | undefined;
  private connectionPromise: Promise<MobbinClientConnection> | undefined;
  private refreshPromise: Promise<void> | undefined;
  private readonly connections = new Set<MobbinClientConnection>();
  private closed = false;

  async search(input: ReferenceInput): Promise<CallToolResult> {
    if (this.closed) throw new MobbinProviderError("Mobbin provider is closed.");
    const native = nativeCall(input);
    let connection: MobbinClientConnection | undefined;
    let failedAccessToken: string | undefined;

    try {
      connection = await this.getConnection();
      const result = await this.callTool(connection, native.name, native.arguments);
      return stripUpstreamMetadata(result);
    } catch (error) {
      if (error instanceof MobbinUnauthorizedError) {
        failedAccessToken = error.accessToken;
      } else if (connection && isUnauthorized(error)) {
        failedAccessToken = connection.accessToken;
      } else {
        throw error;
      }
    }

    if (!failedAccessToken) {
      throw new MobbinProviderError("Mobbin authorization could not be recovered.");
    }
    await this.refreshAfterUnauthorized(failedAccessToken);

    try {
      connection = await this.getConnection();
      const retried = await this.callTool(connection, native.name, native.arguments);
      return stripUpstreamMetadata(retried);
    } catch (error) {
      if (error instanceof MobbinUnauthorizedError || isUnauthorized(error)) {
        throw new MobbinAuthenticationRequiredError();
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const active = [...this.connections];
    await Promise.all(active.map(closeMobbinClientConnection));
    this.connections.clear();
    this.connection = undefined;
    this.connectionPromise = undefined;
  }

  private async getConnection(): Promise<MobbinClientConnection> {
    if (this.closed) throw new MobbinProviderError("Mobbin provider is closed.");
    if (this.connection) return this.connection;
    if (!this.connectionPromise) {
      const pending = this.connectFromStoredBundle();
      this.connectionPromise = pending;
      try {
        const connection = await pending;
        if (this.connectionPromise === pending) {
          this.connection = connection;
          this.connectionPromise = undefined;
        }
        return connection;
      } catch (error) {
        if (this.connectionPromise === pending) this.connectionPromise = undefined;
        throw error;
      }
    }
    const pendingConnection = this.connectionPromise;
    if (!pendingConnection) throw new MobbinProviderError("Mobbin client connection was not initialized.");
    return pendingConnection;
  }

  private async connectFromStoredBundle(): Promise<MobbinClientConnection> {
    const bundle = await readMobbinBundle();
    if (!bundle) throw new MobbinAuthenticationRequiredError();
    const connection = await createMobbinClientConnection(bundle);
    if (this.closed) {
      await closeMobbinClientConnection(connection);
      throw new MobbinProviderError("Mobbin provider is closed.");
    }
    this.connections.add(connection);
    return connection;
  }

  private async callTool(
    connection: MobbinClientConnection,
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    connection.activeCalls += 1;
    try {
      const result = await connection.client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: MCP_CALL_TIMEOUT_MS },
      );
      if (!("content" in result)) {
        throw new MobbinProviderError("Mobbin returned an unsupported tool result.");
      }
      return result as CallToolResult;
    } finally {
      connection.activeCalls -= 1;
      if (connection.closeWhenIdle && connection.activeCalls === 0) {
        await closeMobbinClientConnection(connection);
        this.connections.delete(connection);
      }
    }
  }

  private async refreshAfterUnauthorized(failedAccessToken: string): Promise<void> {
    if (!this.refreshPromise) {
      const pending = this.performRefresh(failedAccessToken);
      this.refreshPromise = pending;
      void pending.then(
        () => {
          if (this.refreshPromise === pending) this.refreshPromise = undefined;
        },
        () => {
          if (this.refreshPromise === pending) this.refreshPromise = undefined;
        },
      );
    }
    const pendingRefresh = this.refreshPromise;
    if (!pendingRefresh) throw new MobbinRefreshError("Mobbin refresh was not initialized.");
    return pendingRefresh;
  }

  private async performRefresh(failedAccessToken: string): Promise<void> {
    let updated: MobbinCredentialBundle;
    try {
      updated = await refreshMobbinBundleAfterUnauthorized(failedAccessToken);
    } catch (error) {
      if (
        error instanceof MobbinAuthenticationRequiredError ||
        error instanceof MobbinConfigurationError ||
        error instanceof MobbinLockError ||
        error instanceof MobbinRefreshError
      ) {
        throw error;
      }
      throw new MobbinRefreshError("Mobbin token refresh failed.", { cause: error });
    }

    const old = this.connection;
    this.connection = undefined;
    this.connectionPromise = undefined;
    if (old) {
      old.closeWhenIdle = true;
      if (old.activeCalls === 0) {
        await closeMobbinClientConnection(old);
        this.connections.delete(old);
      }
    }

    const pending = createMobbinClientConnection(updated);
    this.connectionPromise = pending;
    try {
      const connection = await pending;
      if (this.closed) {
        await closeMobbinClientConnection(connection);
        throw new MobbinProviderError("Mobbin provider is closed.");
      }
      this.connections.add(connection);
      if (this.connectionPromise === pending) {
        this.connection = connection;
        this.connectionPromise = undefined;
      }
    } catch (error) {
      if (this.connectionPromise === pending) this.connectionPromise = undefined;
      if (error instanceof MobbinUnauthorizedError || isUnauthorized(error)) {
        throw new MobbinAuthenticationRequiredError();
      }
      throw error;
    }
  }
}
