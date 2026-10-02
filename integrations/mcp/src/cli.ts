#!/usr/bin/env node
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { ConfigError, writeCredentialFile } from "./config.js";
import {
  createBoundedOAuthFetch,
  commitMobbinBundle,
  MobbinAuthenticationRequiredError,
  MobbinConfigurationError,
  MobbinLockError,
  MobbinOAuthProvider,
  MOBBIN_RESOURCE_METADATA_URL,
  MOBBIN_RESOURCE_URL,
  readMobbinBundle,
  refreshMobbinBundleAfterUnauthorized,
} from "./auth/mobbin.js";
import { GoogleFontsProvider } from "./providers/google-fonts.js";
import { IconifyProvider } from "./providers/iconify.js";
import {
  closeMobbinClientConnection,
  createMobbinClientConnection,
  MobbinUnauthorizedError,
  type MobbinClientConnection,
} from "./providers/mobbin.js";
import { AGENT_IDS, SKILL_IDS, type AgentId, type SkillId } from "./agents.js";
import { AgentConfigurationError } from "./agents.js";
import { InstallStageError } from "./install.js";
import { runInstallCommand, runSetupCommand, OnboardingError } from "./onboarding.js";
import { runStdioServer, SERVER_VERSION } from "./server.js";

const DEFAULT_CALLBACK_PORT = 17_831;
const CALLBACK_TIMEOUT_MS = 5 * 60_000;
const BROWSER_OPEN_TIMEOUT_MS = 10_000;

class CLIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CLIError";
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function usage(): string {
  return [
    "ui-reference-mcp [serve]",
    "ui-reference-mcp install [--agent <id>]... [--skill <id>]... [--skip-auth] [--yes] [--omp-profile <profile>]",
    "ui-reference-mcp setup [--agent <id>]... [--skip-auth] [--yes] [--omp-profile <profile>]",
    "ui-reference-mcp auth [mobbin|google-fonts|iconify]",
    "ui-reference-mcp auth mobbin [--port 1..65535] [--no-browser]",
    "ui-reference-mcp auth google-fonts [--stdin]",
    "ui-reference-mcp auth iconify",
  ].join("\n");
}

function providerList(): string {
  return [
    "Authentication and provider checks:",
    "  auth mobbin       Sign in to Mobbin using browser OAuth.",
    "  auth google-fonts Save and verify an official Google Fonts API key.",
    "  auth iconify      Verify public Iconify access; no key is required.",
  ].join("\n");
}

function responseText(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(text);
}

function equalState(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

export interface CallbackListener {
  waitForAuthorization(): Promise<string>;
  close(): Promise<void>;
}

export async function startCallbackListener(
  port: number,
  stateProvider: () => string,
): Promise<CallbackListener> {
  const expectedHost = `127.0.0.1:${port}`;
  const expectedOrigin = `http://${expectedHost}`;
  const callbackCompletion = createDeferred<string>();
  void callbackCompletion.promise.catch(() => undefined);
  let settled = false;
  let timeout: NodeJS.Timeout | undefined;
  let waiting: Promise<string> | undefined;

  const onRuntimeError = (): void => {
    if (settled) return;
    settled = true;
    callbackCompletion.reject(new CLIError("The loopback authorization callback listener failed."));
  };

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const requestTarget = request.url ?? "/";
    if (!requestTarget.startsWith("/") || requestTarget.startsWith("//")) {
      responseText(response, 400, "Invalid authorization callback.");
      return;
    }
    let url: URL;
    try {
      url = new URL(requestTarget, expectedOrigin);
    } catch {
      responseText(response, 400, "Invalid authorization callback.");
      return;
    }

    if (url.pathname !== "/callback") {
      responseText(response, 404, "Not found.");
      return;
    }
    if (request.method !== "GET") {
      responseText(response, 405, "GET is required.");
      return;
    }
    if (request.headers.host?.toLowerCase() !== expectedHost.toLowerCase()) {
      responseText(response, 400, "Invalid authorization callback host.");
      return;
    }
    if (settled) {
      responseText(response, 400, "Authorization callback already used.");
      return;
    }

    const suppliedStates = url.searchParams.getAll("state");
    const expectedState = stateProvider();
    if (
      suppliedStates.length !== 1 ||
      expectedState.length === 0 ||
      !equalState(suppliedStates[0]!, expectedState)
    ) {
      responseText(response, 400, "Invalid authorization state.");
      return;
    }

    if (url.searchParams.has("error")) {
      settled = true;
      responseText(response, 400, "Authorization was not completed.");
      callbackCompletion.reject(
        new CLIError("Mobbin authorization was declined or failed; existing credentials were preserved."),
      );
      return;
    }

    const codes = url.searchParams.getAll("code");
    if (codes.length !== 1 || codes[0]!.trim() === "") {
      responseText(response, 400, "Invalid authorization callback.");
      return;
    }

    settled = true;
    responseText(response, 200, "Authorization complete. You may return to the terminal.");
    callbackCompletion.resolve(codes[0]!);
  });

  const listening = createDeferred<void>();
  const onListening = (): void => {
    server.off("error", onListenError);
    server.on("error", onRuntimeError);
    listening.resolve(undefined);
  };
  const onListenError = (error: Error): void => {
    server.off("listening", onListening);
    listening.reject(error);
  };
  server.once("listening", onListening);
  server.once("error", onListenError);
  server.listen(port, "127.0.0.1");

  try {
    await listening.promise;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE") {
      throw new CLIError(`Callback port ${port} is busy. Choose another with --port <1-65535>.`);
    }
    throw new CLIError("Unable to start the loopback authorization callback listener.");
  }

  return {
    waitForAuthorization() {
      if (!waiting) {
        const expired = createDeferred<string>();
        timeout = setTimeout(() => {
          settled = true;
          expired.reject(
            new CLIError("Mobbin authorization timed out after five minutes; existing credentials were preserved."),
          );
        }, CALLBACK_TIMEOUT_MS);
        waiting = Promise.race([callbackCompletion.promise, expired.promise]);
      }
      return waiting;
    },
    async close() {
      clearTimeout(timeout);
      timeout = undefined;
      if (!server.listening) return;
      const closed = createDeferred<void>();
      server.close(() => closed.resolve(undefined));
      await closed.promise;
    },
  };
}

function openBrowser(url: string): Promise<boolean> {
  const executable = process.platform === "darwin" ? "open" : "xdg-open";
  const opened = createDeferred<boolean>();
  execFile(
    executable,
    [url],
    { timeout: BROWSER_OPEN_TIMEOUT_MS, windowsHide: true },
    (error) => opened.resolve(error === null),
  );
  return opened.promise;
}

export async function runMobbinAuthorization(port: number, noBrowser: boolean): Promise<void> {
  const existingBundle = await readMobbinBundle();
  const callbackUri = `http://127.0.0.1:${port}/callback`;
  const provider = new MobbinOAuthProvider({ redirectUrl: callbackUri, existingBundle });
  const abortController = new AbortController();
  const listener = await startCallbackListener(port, () => provider.callbackState);
  const cancellationResult = createDeferred<never>();
  let cancelled = false;
  const cancel = (): void => {
    if (cancelled) return;
    cancelled = true;
    abortController.abort();
    cancellationResult.reject(
      new CLIError("Mobbin authorization was canceled; existing credentials were preserved."),
    );
  };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);

  try {
    const authOptions = {
      serverUrl: MOBBIN_RESOURCE_URL,
      scope: "openid",
      resourceMetadataUrl: new URL(MOBBIN_RESOURCE_METADATA_URL),
      fetchFn: createBoundedOAuthFetch(abortController.signal),
    };
    const firstResult = await Promise.race([
      auth(provider, authOptions),
      cancellationResult.promise,
    ]);
    if (firstResult !== "REDIRECT" || !provider.authorizationUrl) {
      throw new CLIError("Mobbin did not start a browser authorization flow; existing credentials were preserved.");
    }

    const authorizationUrl = provider.authorizationUrl.toString();
    process.stdout.write("Open this authorization URL to continue:\n");
    process.stdout.write(`${authorizationUrl}\n`);
    if (!noBrowser && !(await openBrowser(authorizationUrl))) {
      process.stderr.write("Could not open a browser automatically; the authorization URL remains available above.\n");
    }

    const code = await Promise.race([
      listener.waitForAuthorization(),
      cancellationResult.promise,
    ]);
    const authResult = await Promise.race([
      auth(provider, { ...authOptions, authorizationCode: code }),
      cancellationResult.promise,
    ]);
    if (authResult !== "AUTHORIZED") {
      throw new CLIError("Mobbin authorization did not complete; existing credentials were preserved.");
    }

    const bundle = provider.stagedBundle();
    if (!bundle) {
      throw new CLIError("Mobbin did not return a complete credential bundle; existing credentials were preserved.");
    }

    const validation = createMobbinClientConnection(bundle);
    const validationCleanup = validation.then(closeMobbinClientConnection, () => undefined);
    await Promise.race([validation, cancellationResult.promise]);
    await validationCleanup;
    if (abortController.signal.aborted) {
      throw new CLIError("Mobbin authorization was canceled; existing credentials were preserved.");
    }
    await commitMobbinBundle(bundle);
    process.stdout.write("Mobbin authorization and authenticated native tool checks succeeded.\n");
  } catch (error) {
    if (error instanceof CLIError) throw error;
    if (error instanceof MobbinConfigurationError) throw new CLIError(error.message);
    if (error instanceof MobbinLockError) throw new CLIError("Mobbin credentials could not be saved safely.");
    if (error instanceof MobbinAuthenticationRequiredError) throw new CLIError(error.message);
    throw new CLIError("Mobbin authorization or authenticated tool validation failed; existing credentials were preserved.");
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    await listener.close();
    provider.clearTransientState();
  }
}

export async function verifyStoredMobbinCredentials(): Promise<void> {
  let bundle = await readMobbinBundle();
  if (!bundle) {
    throw new CLIError("Mobbin authorization is missing. Run `ui-reference-mcp auth mobbin`.");
  }
  let connection: MobbinClientConnection | undefined;
  try {
    try {
      connection = await createMobbinClientConnection(bundle);
    } catch (error) {
      if (!(error instanceof MobbinUnauthorizedError)) throw error;
      bundle = await refreshMobbinBundleAfterUnauthorized(error.accessToken);
      connection = await createMobbinClientConnection(bundle);
    }
  } catch {
    throw new CLIError("Mobbin saved credentials did not pass authenticated tools/list validation. Run `ui-reference-mcp auth mobbin`.");
  } finally {
    if (connection) await closeMobbinClientConnection(connection);
  }
}

async function readStdinKey(): Promise<string> {
  if (process.stdin.isTTY) return readMaskedKey();
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

function readMaskedKey(): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new CLIError("Google Fonts key entry requires a TTY or explicit --stdin input.");
  }

  const wasRaw = input.isRaw;
  const wasPaused = input.isPaused();
  const characters: string[] = [];
  const result = createDeferred<string>();
  let finished = false;
  process.stdout.write("Google Fonts API key (input hidden): ");

  const cleanup = (): void => {
    input.off("data", onData);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    input.setRawMode(wasRaw);
    if (wasPaused) input.pause();
    process.stdout.write("\n");
  };
  const finish = (error?: Error): void => {
    if (finished) return;
    finished = true;
    cleanup();
    if (error) result.reject(error);
    else result.resolve(characters.join("").trim());
  };
  const onSignal = (): void => {
    finish(new CLIError("Google Fonts key entry was canceled; the saved key was left unchanged."));
  };
  const onData = (chunk: Buffer): void => {
    for (const byte of chunk) {
      if (byte === 3 || byte === 4) {
        finish(new CLIError("Google Fonts key entry was canceled; the saved key was left unchanged."));
        return;
      }
      if (byte === 10 || byte === 13) {
        finish();
        return;
      }
      if (byte === 8 || byte === 127) {
        if (characters.length > 0) {
          characters.pop();
          process.stdout.write("\b \b");
        }
        continue;
      }
      if (byte >= 32) {
        characters.push(String.fromCharCode(byte));
        process.stdout.write("*");
      }
    }
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    input.setRawMode(true);
    input.on("data", onData);
    input.resume();
  } catch {
    finished = true;
    input.off("data", onData);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    try {
      input.setRawMode(wasRaw);
    } catch {
      // The input stream never entered raw mode; continue with the safe command error.
    }
    if (wasPaused) input.pause();
    process.stdout.write("\n");
    result.reject(new CLIError("Unable to enter masked Google Fonts key mode."));
  }
  return result.promise;
}

export async function runGoogleFontsAuthorization(useStdin: boolean): Promise<void> {
  const key = useStdin ? await readStdinKey() : await readMaskedKey();
  if (key.length === 0) throw new CLIError("Google Fonts API key was empty; the saved key was left unchanged.");

  try {
    const provider = new GoogleFontsProvider({ getApiKey: async () => key });
    const results = await provider.search({
      query: "Roboto",
      kind: "font",
      source: "google-fonts",
      limit: 1,
    });
    if (!results.some((font) => font.family === "Roboto")) {
      throw new CLIError("Google Fonts API key validation failed; the saved key was left unchanged.");
    }
  } catch (error) {
    if (error instanceof CLIError) throw error;
    throw new CLIError("Google Fonts API key validation failed; the saved key was left unchanged.");
  }

  try {
    await writeCredentialFile("google-fonts.json", { apiKey: key });
  } catch (error) {
    if (error instanceof ConfigError) throw new CLIError(error.message);
    throw new CLIError("Google Fonts API key could not be saved safely.");
  }
  process.stdout.write("Google Fonts API key verified and saved privately.\n");
}

export async function verifyGoogleFontsCatalog(): Promise<void> {
  try {
    const results = await new GoogleFontsProvider().search({
      query: "Roboto",
      kind: "font",
      source: "google-fonts",
      limit: 1,
    });
    if (!results.some((font) => font.family === "Roboto")) {
      throw new Error("Roboto was not returned by the official catalog.");
    }
  } catch {
    throw new CLIError("Google Fonts credentials did not return the official Roboto catalog. Run `ui-reference-mcp auth google-fonts`.");
  }
}

export async function runIconifyCheck(): Promise<void> {
  try {
    const provider = new IconifyProvider();
    const results = await provider.search({
      query: "credit card",
      kind: "icon",
      source: "iconify",
      limit: 1,
      prefix: "lucide",
    });
    const icon = results[0];
    if (!icon || icon.id !== "lucide:credit-card") {
      throw new CLIError("Iconify did not verify the Lucide credit-card icon.");
    }
    process.stdout.write("Iconify is public and requires no key. Verified lucide:credit-card.\n");
  } catch (error) {
    if (error instanceof CLIError) throw error;
    throw new CLIError("Iconify public search could not be verified right now.");
  }
}

function parsePort(args: string[]): { port: number; noBrowser: boolean } {
  let port = DEFAULT_CALLBACK_PORT;
  let noBrowser = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-browser") {
      noBrowser = true;
      continue;
    }
    if (arg === "--port") {
      const raw = args[index + 1];
      if (raw === undefined || !/^\d+$/.test(raw)) {
        throw new CLIError("Use --port with an integer from 1 through 65535.");
      }
      port = Number(raw);
      index += 1;
      continue;
    }
    throw new CLIError(`Unknown Mobbin option: ${arg}.`);
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new CLIError("Callback port must be an integer from 1 through 65535.");
  }
  return { port, noBrowser };
}

function parseGoogleFontsOptions(args: string[]): boolean {
  if (args.length === 0) return false;
  if (args.length === 1 && args[0] === "--stdin") return true;
  throw new CLIError("Google Fonts auth accepts only the explicit --stdin option.");
}

interface ParsedOnboardingOptions {
  agents?: AgentId[];
  skills?: SkillId[];
  skipAuth: boolean;
  yes: boolean;
  ompProfile?: string;
}

function parseOnboardingOptions(args: string[], allowSkills: boolean): ParsedOnboardingOptions {
  const agents: AgentId[] = [];
  const skills: SkillId[] = [];
  let sawAgent = false;
  let sawSkill = false;
  let skipAuth = false;
  let yes = false;
  let ompProfile: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--agent" || option === "--skill" || option === "--omp-profile") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CLIError(`${option} requires a value.`);
      }
      index += 1;
      if (option === "--agent") {
        if (!AGENT_IDS.includes(value as AgentId)) {
          throw new CLIError(`Unknown agent ${value}; choose omp, codex, claude-code, or cursor.`);
        }
        sawAgent = true;
        agents.push(value as AgentId);
      } else if (option === "--skill") {
        if (!allowSkills) throw new CLIError("setup does not install skills and does not accept --skill.");
        if (!SKILL_IDS.includes(value as SkillId)) {
          throw new CLIError(`Unknown skill ${value}; choose anti-ui-slop, ui-design, or ui-radar.`);
        }
        sawSkill = true;
        skills.push(value as SkillId);
      } else {
        if (ompProfile !== undefined) throw new CLIError("--omp-profile may be specified only once.");
        ompProfile = value;
      }
      continue;
    }
    if (option === "--skip-auth") {
      skipAuth = true;
      continue;
    }
    if (option === "--yes") {
      yes = true;
      continue;
    }
    throw new CLIError(`Unknown onboarding option: ${option}.`);
  }
  return {
    ...(sawAgent ? { agents } : {}),
    ...(sawSkill ? { skills } : {}),
    skipAuth,
    yes,
    ...(ompProfile !== undefined ? { ompProfile } : {}),
  };
}

async function runAuthSelector(): Promise<void> {
  process.stdout.write(`${providerList()}\n`);
  if (!stdin.isTTY || !stdout.isTTY) {
    process.stdout.write("Choose an explicit provider command; no credentials were requested.\n");
    return;
  }
  const prompt = createInterface({ input: stdin, output: stdout, terminal: true });
  let selection: string;
  try {
    selection = (await prompt.question("Select provider [1-3]: ")).trim();
  } finally {
    prompt.close();
  }
  const provider = selection === "1" ? "mobbin" :
    selection === "2" ? "google-fonts" :
      selection === "3" ? "iconify" : undefined;
  if (!provider) throw new CLIError("Select 1, 2, or 3; no provider was changed.");
  await dispatch(["auth", provider]);
}

async function dispatch(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "serve") {
    if (args.length > 1) throw new CLIError("serve does not accept extra arguments.");
    await runStdioServer();
    return;
  }

  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }
  if (args[0] === "install") {
    await runInstallCommand(parseOnboardingOptions(args.slice(1), true));
    return;
  }
  if (args[0] === "setup") {
    await runSetupCommand(parseOnboardingOptions(args.slice(1), false));
    return;
  }
  if (args[0] !== "auth") throw new CLIError(`Unknown command: ${args[0]}.`);
  if (args.length === 1) {
    await runAuthSelector();
    return;
  }

  const provider = args[1];
  const providerArgs = args.slice(2);
  if (provider === "mobbin") {
    const options = parsePort(providerArgs);
    await runMobbinAuthorization(options.port, options.noBrowser);
    return;
  }
  if (provider === "google-fonts") {
    await runGoogleFontsAuthorization(parseGoogleFontsOptions(providerArgs));
    return;
  }
  if (provider === "iconify") {
    if (providerArgs.length > 0) throw new CLIError("Iconify auth takes no options.");
    await runIconifyCheck();
    return;
  }
  throw new CLIError(`Unknown provider: ${provider}.`);
}

function safeCommandError(error: unknown): string {
  if (error instanceof CLIError) return error.message;
  if (
    error instanceof MobbinConfigurationError ||
    error instanceof ConfigError ||
    error instanceof AgentConfigurationError ||
    error instanceof InstallStageError ||
    error instanceof OnboardingError
  ) return error.message;
  return "The command failed safely. Run `ui-reference-mcp --help` for supported commands.";
}

async function main(): Promise<void> {
  try {
    await dispatch(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${safeCommandError(error)}\n`);
    process.exitCode = 1;
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const thisFile = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(thisFile);
  } catch {
    return resolve(entry) === resolve(thisFile);
  }
}

if (isMainModule()) void main();
