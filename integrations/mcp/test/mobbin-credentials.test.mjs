import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

import {
  MobbinAuthenticationRequiredError,
  MobbinConfigurationError,
  commitMobbinBundle,
  readMobbinBundle,
  withMobbinLock,
} from "../dist/auth/mobbin.js";
import { writeCredentialFile } from "../dist/config.js";

const run = promisify(execFile);
const moduleRoot = fileURLToPath(new URL("../dist", import.meta.url));

const bundleFor = (accessToken, refreshToken) => ({
  clientInformation: {
    client_id: "fixture-client",
    redirect_uris: ["http://127.0.0.1:17831/callback"],
    token_endpoint_auth_method: "none",
  },
  tokens: {
    access_token: accessToken,
    token_type: "Bearer",
    refresh_token: refreshToken,
  },
});

const rotationScript = `
import { join } from "node:path";
import { readCredentialFile, writeCredentialFile } from ${JSON.stringify(join(moduleRoot, "config.js"))};
import { withMobbinLock } from ${JSON.stringify(join(moduleRoot, "auth/mobbin.js"))};

const [directory, expiredToken, delay] = process.argv.slice(1);
await withMobbinLock(async ({ assertHealthy }) => {
  const bundle = await readCredentialFile("mobbin.json", (value) => value);
  if (bundle.tokens.access_token !== expiredToken) {
    process.stdout.write("reused\\n");
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, Number(delay)));
  assertHealthy();
  await writeCredentialFile("mobbin.json", {
    clientInformation: bundle.clientInformation,
    tokens: { access_token: "rotated-access", token_type: "Bearer", refresh_token: "rotated-refresh" },
  });
  process.stdout.write("rotated\\n");
});
`;

async function isolatedConfig(run_) {
  const home = await mkdtemp(join(tmpdir(), "ui-reference-mobbin-"));
  const previous = process.env.UI_REFERENCE_CONFIG_DIR;
  const directory = join(home, "config");
  process.env.UI_REFERENCE_CONFIG_DIR = directory;
  try {
    await run_(directory);
  } finally {
    if (previous === undefined) delete process.env.UI_REFERENCE_CONFIG_DIR;
    else process.env.UI_REFERENCE_CONFIG_DIR = previous;
    await rm(home, { recursive: true, force: true });
  }
}

test("simultaneous cross-process rotation happens once and keeps the newest refresh token", async () => {
  await isolatedConfig(async (directory) => {
    await writeCredentialFile("mobbin.json", bundleFor("expired-access", "expired-refresh"));

    const results = await Promise.all(
      [0, 1].map(() => run(
        process.execPath,
        ["--input-type=module", "-e", rotationScript, directory, "expired-access", "250"],
        { env: { ...process.env, UI_REFERENCE_CONFIG_DIR: directory } },
      )),
    );

    const outcomes = results.map((result) => result.stdout.trim()).sort();
    assert.deepEqual(outcomes, ["reused", "rotated"]);

    const stored = await readMobbinBundle();
    assert.equal(stored.tokens.access_token, "rotated-access");
    assert.equal(stored.tokens.refresh_token, "rotated-refresh");
  });
});

test("a malformed stored bundle blocks replacement instead of being overwritten", async () => {
  await isolatedConfig(async (directory) => {
    await writeCredentialFile("mobbin.json", bundleFor("access", "refresh"));
    const path = join(directory, "mobbin.json");
    await writeFile(path, "{", { mode: 0o600 });

    await assert.rejects(() => commitMobbinBundle(bundleFor("new-access", "new-refresh")), MobbinConfigurationError);
    assert.equal(await readFile(path, "utf8"), "{");
  });
});

test("a rejected refresh leaves the stored bundle untouched", async () => {
  await isolatedConfig(async () => {
    await writeCredentialFile("mobbin.json", bundleFor("access", "refresh"));
    await assert.rejects(
      () => commitMobbinBundle({ clientInformation: { client_id: "" }, tokens: { access_token: "", token_type: "" } }),
      MobbinConfigurationError,
    );

    const stored = await readMobbinBundle();
    assert.equal(stored.tokens.access_token, "access");
    assert.equal(stored.clientInformation.client_id, "fixture-client");
  });
});

test("missing credentials are distinguishable from provider errors", async () => {
  await isolatedConfig(async () => {
    assert.equal(await readMobbinBundle(), undefined);
    await assert.rejects(async () => {
      const stored = await readMobbinBundle();
      if (!stored) throw new MobbinAuthenticationRequiredError();
    }, MobbinAuthenticationRequiredError);
  });
});

test("the credential lock lives beside the bundle and is released after use", async () => {
  await isolatedConfig(async (directory) => {
    const observed = await withMobbinLock(async ({ assertHealthy }) => {
      assertHealthy();
      const entries = await readdir(directory);
      return entries;
    });

    assert.ok(observed.includes("mobbin.lock"), `expected a mobbin.lock entry, saw ${observed.join(", ")}`);
    assert.deepEqual(await readdir(directory), []);

    await commitMobbinBundle(bundleFor("access", "refresh"));
    assert.equal((await readMobbinBundle())?.tokens.access_token, "access");
  });
});
