import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse as parseJsonc } from "jsonc-parser";

import {
  planAgentRegistrations,
  registerAgentConfigs,
  resolveAgentConfigPaths,
  resolveSkillDestinations,
} from "../dist/agents.js";

const MANAGED_CLI = "/opt/ui-reference/lib/integrations/mcp/dist/cli.js";

async function withIsolatedHome(run, environment = {}) {
  const home = await mkdtemp(join(tmpdir(), "ui-reference-agents-"));
  const names = ["HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "PI_CONFIG_DIR", "PI_CODING_AGENT_DIR", "OMP_PROFILE", "PI_PROFILE", "PATH"];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  process.env.HOME = home;
  process.env.PATH = "";
  for (const name of names) {
    if (name === "HOME" || name === "PATH") continue;
    if (environment[name] !== undefined) process.env[name] = environment[name];
    else delete process.env[name];
  }
  try {
    await run(home);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(home, { recursive: true, force: true });
  }
}

test("global targets resolve to documented default and relocated paths", async () => {
  await withIsolatedHome(async (home) => {
    const defaults = await resolveAgentConfigPaths(["codex", "claude-code", "cursor", "omp"]);
    const byAgent = new Map(defaults.map((target) => [target.agent, target]));
    assert.equal(byAgent.get("codex").configPath, join(home, ".codex", "config.toml"));
    assert.equal(byAgent.get("claude-code").configPath, join(home, ".claude.json"));
    assert.equal(byAgent.get("cursor").configPath, join(home, ".cursor", "mcp.json"));
    assert.equal(byAgent.get("omp").configPath, join(home, ".omp", "agent", "mcp.json"));
    assert.equal(byAgent.get("codex").format, "toml");
    for (const agent of ["omp", "claude-code", "cursor"]) assert.equal(byAgent.get(agent).format, "jsonc");
  });

  const relocated = await mkdtemp(join(tmpdir(), "ui-reference-relocated-"));
  try {
    await withIsolatedHome(async () => {
      const targets = await resolveAgentConfigPaths(["codex", "claude-code"]);
      const byAgent = new Map(targets.map((target) => [target.agent, target]));
      assert.equal(byAgent.get("codex").configPath, join(relocated, "codex-home", "config.toml"));
      assert.equal(byAgent.get("claude-code").configPath, join(relocated, "claude-config", ".claude.json"));
    }, { CODEX_HOME: join(relocated, "codex-home"), CLAUDE_CONFIG_DIR: join(relocated, "claude-config") });
  } finally {
    await rm(relocated, { recursive: true, force: true });
  }
});

test("omp profile and agent-directory overrides select the active profile only", async () => {
  const agentDir = join(tmpdir(), "ui-reference-omp-agent-dir");
  await withIsolatedHome(async () => {
    const defaultTarget = (await resolveAgentConfigPaths(["omp"]))[0];
    assert.equal(defaultTarget.configPath, join(agentDir, "mcp.json"));
  }, { PI_CODING_AGENT_DIR: agentDir });

  await withIsolatedHome(async (home) => {
    const fallbackTarget = (await resolveAgentConfigPaths(["omp"]))[0];
    assert.equal(fallbackTarget.configPath, join(home, ".omp", "agent", "mcp.json"));
  });

  await withIsolatedHome(async (home) => {
    const profileTarget = (await resolveAgentConfigPaths(["omp"], { ompProfile: "work" }))[0];
    assert.equal(profileTarget.configPath, join(home, ".omp", "profiles", "work", "agent", "mcp.json"));
  });

  await withIsolatedHome(async (home) => {
    const environmentProfile = (await resolveAgentConfigPaths(["omp"]))[0];
    assert.equal(environmentProfile.configPath, join(home, ".omp", "profiles", "env", "agent", "mcp.json"));
  }, { OMP_PROFILE: "env", PI_CODING_AGENT_DIR: "ignored-agent-dir" });

  await withIsolatedHome(async () => {
    await assert.rejects(() => resolveAgentConfigPaths(["omp"], { ompProfile: "../escape" }));
    await assert.rejects(() => resolveAgentConfigPaths(["omp"], { ompProfile: "default" }));
  });
});

test("skill destinations share the canonical agents directory and honor relocations", async () => {
  await withIsolatedHome(async (home) => {
    const destinations = await resolveSkillDestinations(["codex", "cursor", "claude-code", "omp"], ["anti-ui-slop"]);
    const pathFor = (agent) => destinations.find((destination) => destination.agent === agent).path;

    assert.equal(pathFor("codex"), join(home, ".agents", "skills", "anti-ui-slop"));
    assert.equal(pathFor("cursor"), pathFor("codex"));
    assert.equal(pathFor("claude-code"), join(home, ".claude", "skills", "anti-ui-slop"));
    assert.equal(pathFor("omp"), join(home, ".omp", "agent", "skills", "anti-ui-slop"));
  }, { CLAUDE_CONFIG_DIR: undefined });
});

test("JSONC registration preserves comments, unrelated servers, and policy keys", async () => {
  await withIsolatedHome(async (home) => {
    const configPath = join(home, ".cursor", "mcp.json");
    await mkdir(join(home, ".cursor"), { recursive: true });
    await writeFile(configPath, `{
  // keep this comment
  "mcpServers": {
    "notes": { "command": "notes-server" } // unrelated server
  },
  "permissions": { "allow": ["Read"] }
}
`, { mode: 0o600 });

    const plans = await planAgentRegistrations(["cursor"], MANAGED_CLI);
    assert.equal(plans[0].state, "new");
    const results = await registerAgentConfigs(plans, { replace: new Set(), enable: new Set() });
    assert.equal(results[0].status, "registered");

    const updated = await readFile(configPath, "utf8");
    assert.match(updated, /keep this comment/);
    assert.match(updated, /unrelated server/);
    assert.match(updated, /"permissions"/);
    const parsed = parseJsonc(updated);
    assert.deepEqual(parsed.mcpServers.notes, { command: "notes-server" });
    assert.deepEqual(parsed.mcpServers["ui-reference"], {
      type: "stdio",
      command: process.execPath,
      args: [MANAGED_CLI, "serve"],
    });

    const second = await planAgentRegistrations(["cursor"], MANAGED_CLI);
    assert.equal(second[0].state, "identical");
  });
});

test("a foreign ui-reference entry requires explicit replacement consent", async () => {
  await withIsolatedHome(async (home) => {
    const configPath = join(home, ".cursor", "mcp.json");
    await mkdir(join(home, ".cursor"), { recursive: true });
    const original = `{
  "mcpServers": {
    "ui-reference": { "type": "http", "url": "https://example.com/mcp" }
  }
}
`;
    await writeFile(configPath, original, { mode: 0o600 });

    const plans = await planAgentRegistrations(["cursor"], MANAGED_CLI);
    assert.equal(plans[0].state, "conflict");
    await assert.rejects(
      () => registerAgentConfigs(plans, { replace: new Set(), enable: new Set() }),
      /Replacement was not approved/,
    );
    assert.equal(await readFile(configPath, "utf8"), original);

    const consented = await registerAgentConfigs(plans, { replace: new Set([configPath]), enable: new Set() });
    assert.equal(consented[0].status, "registered");
    const updated = parseJsonc(await readFile(configPath, "utf8"));
    assert.equal(updated.mcpServers["ui-reference"].url, undefined);
    assert.equal(updated.mcpServers["ui-reference"].command, process.execPath);
  });
});

test("a denylisted ui-reference entry requires enable consent", async () => {
  await withIsolatedHome(async (home) => {
    const configPath = join(home, ".cursor", "mcp.json");
    await mkdir(join(home, ".cursor"), { recursive: true });
    await writeFile(configPath, `{
  "mcpServers": {},
  "disabledMcpServers": ["ui-reference", "notes"]
}
`, { mode: 0o600 });

    const plans = await planAgentRegistrations(["cursor"], MANAGED_CLI);
    assert.equal(plans[0].denied, true);
    await assert.rejects(
      () => registerAgentConfigs(plans, { replace: new Set(), enable: new Set() }),
      /Enabling ui-reference was not approved/,
    );

    await registerAgentConfigs(plans, { replace: new Set(), enable: new Set([configPath]) });
    const parsed = JSON.parse(await readFile(configPath, "utf8"));
    assert.deepEqual(parsed.disabledMcpServers, ["notes"]);
    assert.ok(parsed.mcpServers["ui-reference"]);
  });
});

test("Codex TOML registration preserves comments and unrelated MCP servers", async () => {
  await withIsolatedHome(async (home) => {
    const configPath = join(home, ".codex", "config.toml");
    await mkdir(join(home, ".codex"), { recursive: true });
    await writeFile(configPath, `# codex settings
model = "gpt-5"

[mcp_servers.notes]
command = "notes-server"
enabled = true
`, { mode: 0o600 });

    const plans = await planAgentRegistrations(["codex"], MANAGED_CLI);
    const results = await registerAgentConfigs(plans, { replace: new Set(), enable: new Set() });
    assert.equal(results[0].status, "registered");

    const updated = await readFile(configPath, "utf8");
    assert.match(updated, /# codex settings/);
    assert.match(updated, /model = "gpt-5"/);
    assert.match(updated, /\[mcp_servers\.notes\]/);
    assert.match(updated, /command = "notes-server"/);
    assert.match(updated, /\[mcp_servers\."ui-reference"\]/);
    assert.match(updated, /enabled = true/);
    assert.ok(updated.includes(JSON.stringify(MANAGED_CLI)));

    const second = await planAgentRegistrations(["codex"], MANAGED_CLI);
    assert.equal(second[0].state, "identical");
  });
});

test("Codex TOML registration edits an inline mcp_servers table in place", async () => {
  await withIsolatedHome(async (home) => {
    const configPath = join(home, ".codex", "config.toml");
    await mkdir(join(home, ".codex"), { recursive: true });
    await writeFile(configPath, 'mcp_servers = { notes = { command = "notes-server" } }\n', { mode: 0o600 });

    const plans = await planAgentRegistrations(["codex"], MANAGED_CLI);
    await registerAgentConfigs(plans, { replace: new Set(), enable: new Set() });

    const updated = await readFile(configPath, "utf8");
    assert.match(updated, /notes-server/);
    assert.match(updated, /ui-reference/);
    assert.equal(updated.trim().split("\n").length, 1);
  });
});

test("malformed or symlinked agent configuration is refused before any write", async () => {
  await withIsolatedHome(async (home) => {
    const configPath = join(home, ".cursor", "mcp.json");
    await mkdir(join(home, ".cursor"), { recursive: true });
    await writeFile(configPath, "{ not json", { mode: 0o600 });

    await assert.rejects(() => planAgentRegistrations(["cursor"], MANAGED_CLI), /configuration/i);
    assert.equal(await readFile(configPath, "utf8"), "{ not json");
  });
});
