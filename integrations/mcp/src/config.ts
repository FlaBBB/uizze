import { constants as fsConstants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const CREDENTIAL_NAME = /^[a-z0-9][a-z0-9-]*\.json$/;

export class ConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigError";
  }
}

export function getConfigDir(): string {
  const configured = process.env.UI_REFERENCE_CONFIG_DIR;
  if (configured !== undefined && configured.trim() !== "") {
    return resolve(configured.trim());
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const base = xdgConfigHome && xdgConfigHome.trim() !== ""
    ? resolve(xdgConfigHome.trim())
    : join(homedir(), ".config");
  return join(base, "ui-reference-mcp");
}

/** Create and secure only the managed application directory, never its parents. */
export async function ensureConfigDir(): Promise<string> {
  const directory = getConfigDir();
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });

  let stats;
  try {
    stats = await lstat(directory);
  } catch (error) {
    throw new ConfigError(`Unable to inspect configuration directory: ${directory}`, {
      cause: error,
    });
  }

  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new ConfigError(`Configuration path must be a real directory: ${directory}`);
  }

  if ((stats.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) {
    try {
      await chmod(directory, PRIVATE_DIRECTORY_MODE);
    } catch (error) {
      throw new ConfigError(
        `Configuration directory must have mode 0700; fix permissions on ${directory}.`,
        { cause: error },
      );
    }
  }

  return directory;
}

function credentialPath(directory: string, name: string): string {
  if (!CREDENTIAL_NAME.test(name)) {
    throw new ConfigError("Credential file name must be a simple lowercase JSON filename.");
  }
  return join(directory, name);
}

async function openPrivateCredential(path: string) {
  let linkStats;
  try {
    linkStats = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new ConfigError(`Unable to inspect credential file: ${path}`, { cause: error });
  }

  if (linkStats.isSymbolicLink() || !linkStats.isFile()) {
    throw new ConfigError(`Credential path must be a regular, non-symlink file: ${path}`);
  }
  if ((linkStats.mode & 0o077) !== 0) {
    throw new ConfigError(`Credential file must not be accessible by group or others: ${path}`);
  }

  let handle;
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    handle = await open(path, fsConstants.O_RDONLY | noFollow);
    const stats = await handle.stat();
    if (!stats.isFile() || (stats.mode & 0o077) !== 0) {
      throw new ConfigError(`Credential file must be a private regular file: ${path}`);
    }
    return handle;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(`Unable to open credential file safely: ${path}`, { cause: error });
  }
}

export async function readCredentialFile<T>(
  name: string,
  validate: (value: unknown) => T,
): Promise<T | undefined> {
  const directory = await ensureConfigDir();
  const path = credentialPath(directory, name);
  const handle = await openPrivateCredential(path);
  if (!handle) return undefined;

  try {
    const contents = await handle.readFile({ encoding: "utf8" });
    let value: unknown;
    try {
      value = JSON.parse(contents);
    } catch (error) {
      throw new ConfigError(`Credential file contains malformed JSON: ${path}`, {
        cause: error,
      });
    }
    try {
      return validate(value);
    } catch (error) {
      if (error instanceof ConfigError) throw error;
      throw new ConfigError(`Credential file has an invalid format: ${path}`, { cause: error });
    }
  } finally {
    await handle.close();
  }
}

export async function writeCredentialFile(name: string, value: unknown): Promise<void> {
  const directory = await ensureConfigDir();
  const path = credentialPath(directory, name);
  const previous = await openPrivateCredential(path);
  if (previous) {
    try {
      const existingContents = await previous.readFile({ encoding: "utf8" });
      try {
        JSON.parse(existingContents);
      } catch (error) {
        throw new ConfigError(`Credential file contains malformed JSON: ${path}`, {
          cause: error,
        });
      }
    } finally {
      await previous.close();
    }
  }

  const temporaryPath = join(
    directory,
    `.${name}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(
      temporaryPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
      PRIVATE_FILE_MODE,
    );
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;

    // Recheck so an attacker cannot replace the destination with a symlink.
    const current = await openPrivateCredential(path);
    await current?.close();
    await rename(temporaryPath, path);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(`Unable to save credential file safely: ${path}`, { cause: error });
  }
}

export async function getGoogleFontsApiKey(): Promise<string | undefined> {
  const stored = await readCredentialFile("google-fonts.json", (value) => {
    const record = typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
    if (
      !record ||
      Object.keys(record).some((key) => key !== "apiKey") ||
      typeof record.apiKey !== "string" ||
      record.apiKey.trim() === ""
    ) {
      throw new ConfigError("google-fonts.json must contain only a nonempty apiKey string.");
    }
    return { apiKey: record.apiKey.trim() };
  });
  if (stored) return stored.apiKey;

  const environmentKey = process.env.GOOGLE_FONTS_API_KEY;
  return environmentKey && environmentKey.trim() !== ""
    ? environmentKey.trim()
    : undefined;
}

