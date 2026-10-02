import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { lock as acquireLock } from "proper-lockfile";
import { z } from "zod";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  OAuthClientInformationFullSchema,
  OAuthClientInformationSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  ConfigError,
  ensureConfigDir,
  readCredentialFile,
  writeCredentialFile,
} from "../config.js";

export const MOBBIN_RESOURCE_URL = "https://api.mobbin.com/mcp";
export const MOBBIN_RESOURCE_METADATA_URL =
  "https://api.mobbin.com/.well-known/oauth-protected-resource/mcp";
export const MOBBIN_CREDENTIAL_FILE = "mobbin.json";
const OAUTH_TIMEOUT_MS = 30_000;
const mobbinBundleSchema = z
  .object({
    clientInformation: z.union([
      OAuthClientInformationFullSchema,
      OAuthClientInformationSchema,
    ]),
    tokens: OAuthTokensSchema,
  })
  .strict()
  .superRefine((bundle, context) => {
    if (bundle.clientInformation.client_id.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["clientInformation", "client_id"],
        message: "Client registration ID must not be empty.",
      });
    }
    if (bundle.tokens.access_token.trim() === "" || bundle.tokens.token_type.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["tokens"],
        message: "OAuth token fields must not be empty.",
      });
    }
    if (bundle.tokens.refresh_token !== undefined && bundle.tokens.refresh_token.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["tokens", "refresh_token"],
        message: "Refresh token must not be empty.",
      });
    }
  });

export interface MobbinCredentialBundle {
  clientInformation: OAuthClientInformationMixed;
  tokens: OAuthTokens;
}

export class MobbinConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MobbinConfigurationError";
  }
}

export class MobbinAuthenticationRequiredError extends Error {
  constructor(message = "Mobbin login is missing or expired. Run `ui-reference-mcp auth mobbin`.") {
    super(message);
    this.name = "MobbinAuthenticationRequiredError";
  }
}

export class MobbinLockError extends Error {
  constructor(message = "Mobbin credentials are locked by another process or the lock was compromised.", options?: ErrorOptions) {
    super(message, options);
    this.name = "MobbinLockError";
  }
}

/** Raised by a refresh provider so the SDK cannot turn a revoked login into a browser flow. */
export class MobbinRefreshRejectedError extends Error {
  constructor() {
    super("Mobbin refresh credentials were rejected.");
    this.name = "MobbinRefreshRejectedError";
  }
}

export function validateMobbinBundle(value: unknown): MobbinCredentialBundle {
  const parsed = mobbinBundleSchema.safeParse(value);
  if (!parsed.success) {
    throw new MobbinConfigurationError("mobbin.json contains an invalid credential bundle.", {
      cause: parsed.error,
    });
  }
  return {
    clientInformation: parsed.data.clientInformation,
    tokens: parsed.data.tokens,
  };
}

export async function readMobbinBundle(): Promise<MobbinCredentialBundle | undefined> {
  try {
    return await readCredentialFile(MOBBIN_CREDENTIAL_FILE, validateMobbinBundle);
  } catch (error) {
    if (error instanceof MobbinConfigurationError) throw error;
    if (error instanceof ConfigError) {
      throw new MobbinConfigurationError(error.message, { cause: error });
    }
    throw new MobbinConfigurationError("Unable to read Mobbin credentials safely.", {
      cause: error,
    });
  }
}

async function writeMobbinBundle(bundle: MobbinCredentialBundle): Promise<void> {
  const validated = validateMobbinBundle(bundle);
  try {
    await writeCredentialFile(MOBBIN_CREDENTIAL_FILE, validated);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw new MobbinConfigurationError(error.message, { cause: error });
    }
    throw new MobbinConfigurationError("Mobbin credentials could not be saved safely.", {
      cause: error,
    });
  }
}

export function createBoundedOAuthFetch(signal?: AbortSignal): FetchLike {
  return (input, init = {}) => {
    const signals = [AbortSignal.timeout(OAUTH_TIMEOUT_MS)];
    if (signal) signals.push(signal);
    if (init.signal) signals.push(init.signal);
    return fetch(input, { ...init, signal: AbortSignal.any(signals) });
  };
}

export interface MobbinLockContext {
  signal: AbortSignal;
  assertHealthy(): void;
}

const LOCK_OPTIONS = {
  stale: 30_000,
  update: 5_000,
  retries: {
    retries: 240,
    factor: 1,
    minTimeout: 500,
    maxTimeout: 500,
    randomize: false,
  },
} as const;

/** Acquire the single cross-process Mobbin lock; never operate after compromise. */
export async function withMobbinLock<T>(
  operation: (context: MobbinLockContext) => Promise<T>,
): Promise<T> {
  let directory: string;
  try {
    directory = await ensureConfigDir();
  } catch (error) {
    if (error instanceof ConfigError) {
      throw new MobbinConfigurationError(error.message, { cause: error });
    }
    throw new MobbinConfigurationError("Mobbin credentials cannot use the configured directory safely.", {
      cause: error,
    });
  }

  const bundlePath = join(directory, MOBBIN_CREDENTIAL_FILE);
  const lockfilePath = join(directory, "mobbin.lock");
  const abortController = new AbortController();
  let compromised = false;
  const release = await acquireLock(bundlePath, {
    ...LOCK_OPTIONS,
    lockfilePath,
    realpath: false,
    onCompromised: (error) => {
      compromised = true;
      abortController.abort(error);
    },
  }).catch((error: unknown) => {
    throw new MobbinLockError(undefined, { cause: error });
  });

  const assertHealthy = (): void => {
    if (compromised || abortController.signal.aborted) {
      throw new MobbinLockError();
    }
  };

  try {
    assertHealthy();
    const result = await operation({ signal: abortController.signal, assertHealthy });
    assertHealthy();
    return result;
  } finally {
    try {
      await release();
    } catch (error) {
      throw new MobbinLockError("Unable to release the Mobbin credential lock safely.", {
        cause: error,
      });
    }
  }
}

export async function commitMobbinBundle(bundle: MobbinCredentialBundle): Promise<void> {
  const validated = validateMobbinBundle(bundle);
  await withMobbinLock(async ({ assertHealthy }) => {
    // Read the latest value while holding the lock; malformed credentials are never replaced.
    await readMobbinBundle();
    assertHealthy();
    await writeMobbinBundle(validated);
    assertHealthy();
  });
}

export interface MobbinOAuthProviderOptions {
  redirectUrl?: string;
  existingBundle?: MobbinCredentialBundle;
  useStoredTokens?: boolean;
  refreshMode?: boolean;
}

/** A memory-only staging provider: callers decide when staged credentials are committed. */
export class MobbinOAuthProvider implements OAuthClientProvider {
  readonly redirectUrl: string | undefined;
  readonly clientMetadata: OAuthClientMetadata;
  private stagedClientInformation: OAuthClientInformationMixed | undefined;
  private stagedTokens: OAuthTokens | undefined;
  private stagedDiscoveryState: OAuthDiscoveryState | undefined;
  private stagedCodeVerifier: string | undefined;
  private authorizationState = randomBytes(32).toString("base64url");
  private stagedAuthorizationUrl: URL | undefined;
  private readonly refreshMode: boolean;

  constructor(options: MobbinOAuthProviderOptions) {
    this.redirectUrl = options.redirectUrl;
    this.refreshMode = options.refreshMode ?? false;
    const existingClientInformation = options.existingBundle?.clientInformation;
    const matchesRedirect = options.refreshMode === true || (
      options.redirectUrl !== undefined &&
      existingClientInformation !== undefined &&
      "redirect_uris" in existingClientInformation &&
      existingClientInformation.redirect_uris.includes(options.redirectUrl)
    );
    this.stagedClientInformation = matchesRedirect ? existingClientInformation : undefined;
    this.stagedTokens = options.useStoredTokens ? options.existingBundle?.tokens : undefined;
    this.clientMetadata = {
      client_name: "UI Reference MCP",
      redirect_uris: options.redirectUrl ? [options.redirectUrl] : [],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "openid",
    };
  }

  state(): string {
    return this.authorizationState;
  }

  get callbackState(): string {
    return this.authorizationState;
  }

  get authorizationUrl(): URL | undefined {
    return this.stagedAuthorizationUrl;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.stagedClientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    this.stagedClientInformation = clientInformation;
  }

  tokens(): OAuthTokens | undefined {
    return this.stagedTokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const previousRefreshToken = this.refreshMode ? this.stagedTokens?.refresh_token : undefined;
    this.stagedTokens = {
      ...tokens,
      ...(tokens.refresh_token === undefined && previousRefreshToken !== undefined
        ? { refresh_token: previousRefreshToken }
        : {}),
    };
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this.stagedAuthorizationUrl = authorizationUrl;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.stagedCodeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.stagedCodeVerifier) {
      throw new MobbinAuthenticationRequiredError("Mobbin authorization state expired; run `ui-reference-mcp auth mobbin` again.");
    }
    return this.stagedCodeVerifier;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    this.stagedDiscoveryState = state;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.stagedDiscoveryState;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (this.refreshMode && (scope === "all" || scope === "client" || scope === "tokens")) {
      throw new MobbinRefreshRejectedError();
    }
    if (scope === "all" || scope === "client") this.stagedClientInformation = undefined;
    if (scope === "all" || scope === "tokens") this.stagedTokens = undefined;
    if (scope === "all" || scope === "verifier") this.stagedCodeVerifier = undefined;
    if (scope === "all" || scope === "discovery") this.stagedDiscoveryState = undefined;
  }

  stagedBundle(): MobbinCredentialBundle | undefined {
    if (!this.stagedClientInformation || !this.stagedTokens) return undefined;
    return validateMobbinBundle({
      clientInformation: this.stagedClientInformation,
      tokens: this.stagedTokens,
    });
  }

  clearTransientState(): void {
    this.stagedCodeVerifier = undefined;
    this.stagedAuthorizationUrl = undefined;
    this.stagedDiscoveryState = undefined;
    this.authorizationState = "";
  }
}

/** Refresh only after a 401, serialized with credential commits from every process. */
export async function refreshMobbinBundleAfterUnauthorized(
  failedAccessToken: string,
): Promise<MobbinCredentialBundle> {
  return withMobbinLock(async ({ signal, assertHealthy }) => {
    const current = await readMobbinBundle();
    if (!current) throw new MobbinAuthenticationRequiredError();
    if (current.tokens.access_token !== failedAccessToken) return current;
    if (!current.tokens.refresh_token) throw new MobbinAuthenticationRequiredError();

    const provider = new MobbinOAuthProvider({
      existingBundle: current,
      useStoredTokens: true,
      refreshMode: true,
    });
    let result: "AUTHORIZED" | "REDIRECT";
    try {
      result = await auth(provider, {
        serverUrl: MOBBIN_RESOURCE_URL,
        scope: "openid",
        resourceMetadataUrl: new URL(MOBBIN_RESOURCE_METADATA_URL),
        fetchFn: createBoundedOAuthFetch(signal),
      });
    } catch (error) {
      if (error instanceof MobbinRefreshRejectedError) {
        throw new MobbinAuthenticationRequiredError();
      }
      throw new MobbinRefreshError("Mobbin token refresh failed.", { cause: error });
    }

    assertHealthy();
    if (result !== "AUTHORIZED") throw new MobbinAuthenticationRequiredError();
    const updated = provider.stagedBundle();
    if (!updated) throw new MobbinAuthenticationRequiredError();
    assertHealthy();
    await writeMobbinBundle(updated);
    return updated;
  });
}

export class MobbinRefreshError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MobbinRefreshError";
  }
}
