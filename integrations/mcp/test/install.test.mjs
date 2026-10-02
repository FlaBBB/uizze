import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

import { planSkillInstall } from "../dist/install.js";

const run = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const cliPath = join(repositoryRoot, "integrations/mcp/dist/cli.js");

async function runCli(args, { home, extraEnv = {} }) {
  try {
    const result = await run(process.execPath, [cliPath, ...args], {
      cwd: repositoryRoot,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        ...extraEnv,
      },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

async function withHome(run_) {
  const home = await mkdtemp(join(tmpdir(), "ui-reference-install-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    await run_(home);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
}

test("non-TTY install fails before any mutation without explicit selection and --yes", async () => {
  await withHome(async (home) => {
    const result = await runCli(["install"], { home });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Non-TTY install requires explicit --agent, --skill, and --yes/);
    assert.deepEqual(await readdir(home), []);
  });
});

test("non-TTY setup fails before any mutation without explicit --agent and --yes", async () => {
  await withHome(async (home) => {
    const result = await runCli(["setup"], { home });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Non-TTY setup requires explicit --agent and --yes/);
    assert.deepEqual(await readdir(home), []);
  });
});

test("setup refuses --skill and unknown selections before touching configuration", async () => {
  await withHome(async (home) => {
    const withSkill = await runCli(["setup", "--agent", "cursor", "--skill", "ui-radar", "--yes"], { home });
    assert.equal(withSkill.code, 1);
    assert.match(withSkill.stderr, /setup does not install skills/);

    const unknownAgent = await runCli(["install", "--agent", "emacs", "--yes"], { home });
    assert.equal(unknownAgent.code, 1);
    assert.match(unknownAgent.stderr, /Unknown agent emacs/);

    assert.deepEqual(await readdir(home), []);
  });
});

test("an existing differing skill tree is a conflict that --yes alone does not replace", async () => {
  await withHome(async (home) => {
    const destination = join(home, ".agents", "skills", "ui-radar");
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "SKILL.md"), "user edited this skill\n");

    const plans = await planSkillInstall(repositoryRoot, ["codex"], ["ui-radar"]);
    const plan = plans.find((entry) => entry.path === destination);
    assert.equal(plan.state, "conflict");
    assert.equal(await readFile(join(destination, "SKILL.md"), "utf8"), "user edited this skill\n");
  });
});

test("a source-identical skill destination is reused rather than replaced", async () => {
  await withHome(async (home) => {
    const source = join(repositoryRoot, "skills", "ui-radar");
    const destination = join(home, ".agents", "skills", "ui-radar");
    await mkdir(join(home, ".agents", "skills"), { recursive: true });
    await run("cp", ["-R", source, destination]);

    const plans = await planSkillInstall(repositoryRoot, ["codex", "cursor"], ["ui-radar"]);
    assert.equal(plans.length, 1);
    assert.equal(plans[0].path, destination);
    assert.equal(plans[0].state, "identical");
    assert.deepEqual([...plans[0].agents].sort(), ["codex", "cursor"]);
  });
});

test("the runtime prefix override is honored for the durable terminal binary path", async () => {
  await withHome(async (home) => {
    const prefix = join(home, "custom-prefix");
    const result = await runCli(["--version"], { home, extraEnv: { UI_REFERENCE_INSTALL_PREFIX: prefix } });

    assert.equal(result.code, 0);
    assert.equal(result.stdout.trim(), "1.0.0");
    assert.deepEqual(await readdir(home), []);
  });
});
