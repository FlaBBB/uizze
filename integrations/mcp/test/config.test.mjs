import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ConfigError,
  getConfigDir,
  getGoogleFontsApiKey,
  readCredentialFile,
  writeCredentialFile,
} from "../dist/config.js";

async function withIsolatedConfig(run) {
  const home = await mkdtemp(join(tmpdir(), "ui-reference-config-"));
  const previousConfig = process.env.UI_REFERENCE_CONFIG_DIR;
  const previousKey = process.env.GOOGLE_FONTS_API_KEY;
  const previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.UI_REFERENCE_CONFIG_DIR = join(home, "config");
  delete process.env.GOOGLE_FONTS_API_KEY;
  try {
    await run(process.env.UI_REFERENCE_CONFIG_DIR);
  } finally {
    if (previousConfig === undefined) delete process.env.UI_REFERENCE_CONFIG_DIR;
    else process.env.UI_REFERENCE_CONFIG_DIR = previousConfig;
    if (previousKey === undefined) delete process.env.GOOGLE_FONTS_API_KEY;
    else process.env.GOOGLE_FONTS_API_KEY = previousKey;
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    await rm(home, { recursive: true, force: true });
  }
}

test("credential files are written privately and atomically", async () => {
  await withIsolatedConfig(async (directory) => {
    await writeCredentialFile("google-fonts.json", { apiKey: "first" });
    await writeCredentialFile("google-fonts.json", { apiKey: "second" });

    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(join(directory, "google-fonts.json"))).mode & 0o777, 0o600);
    assert.deepEqual(await readCredentialFile("google-fonts.json", (value) => value), { apiKey: "second" });
    assert.deepEqual(await readdir(directory), ["google-fonts.json"]);
  });
});

test("malformed credentials fail loudly instead of reading as empty", async () => {
  await withIsolatedConfig(async (directory) => {
    await writeCredentialFile("google-fonts.json", { apiKey: "valid" });
    await writeFile(join(directory, "google-fonts.json"), "{", { mode: 0o600 });

    await assert.rejects(
      () => readCredentialFile("google-fonts.json", (value) => value),
      ConfigError,
    );
  });
});

test("group-readable credentials and symlinked credentials are refused", async () => {
  await withIsolatedConfig(async (directory) => {
    await writeCredentialFile("google-fonts.json", { apiKey: "valid" });
    const path = join(directory, "google-fonts.json");

    await chmod(path, 0o644);
    await assert.rejects(() => readCredentialFile("google-fonts.json", (value) => value), ConfigError);

    await rm(path);
    await writeFile(join(directory, "target.json"), JSON.stringify({ apiKey: "linked" }), { mode: 0o600 });
    await symlink(join(directory, "target.json"), path);
    await assert.rejects(() => readCredentialFile("google-fonts.json", (value) => value), ConfigError);
  });
});

test("a stored Google key wins over an inherited environment key", async () => {
  await withIsolatedConfig(async () => {
    process.env.GOOGLE_FONTS_API_KEY = "stale-environment-key";
    assert.equal(await getGoogleFontsApiKey(), "stale-environment-key");

    await writeCredentialFile("google-fonts.json", { apiKey: "stored-key" });
    assert.equal(await getGoogleFontsApiKey(), "stored-key");
  });
});

test("the config directory honors UI_REFERENCE_CONFIG_DIR and XDG_CONFIG_HOME", async () => {
  await withIsolatedConfig(async (directory) => {
    assert.equal(getConfigDir(), directory);

    delete process.env.UI_REFERENCE_CONFIG_DIR;
    process.env.XDG_CONFIG_HOME = directory;
    assert.equal(getConfigDir(), join(directory, "ui-reference-mcp"));
  });
});

test("an invalid stored Google key shape is rejected rather than ignored", async () => {
  await withIsolatedConfig(async () => {
    await writeCredentialFile("google-fonts.json", { apiKey: "valid" });
    await writeCredentialFile("google-fonts.json", { apiKey: "  " });
    await assert.rejects(() => getGoogleFontsApiKey(), ConfigError);
  });
});
