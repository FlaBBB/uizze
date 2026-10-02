import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const cliPath = join(repositoryRoot, "integrations/mcp/dist/cli.js");

async function withServer(run) {
  const home = await mkdtemp(join(tmpdir(), "ui-reference-server-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath],
    cwd: repositoryRoot,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      UI_REFERENCE_CONFIG_DIR: join(home, "config"),
    },
  });
  const client = new Client({ name: "ui-reference-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    await run(client);
  } finally {
    await client.close().catch(() => undefined);
    await rm(home, { recursive: true, force: true });
  }
}

test("the server exposes exactly the two documented tools without credentials", async () => {
  await withServer(async (client) => {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["find_ui_materials", "find_ui_references"]);

    const references = listed.tools.find((tool) => tool.name === "find_ui_references");
    const materials = listed.tools.find((tool) => tool.name === "find_ui_materials");
    assert.equal(references.annotations.readOnlyHint, true);
    assert.equal(materials.annotations.readOnlyHint, true);
    assert.ok(materials.outputSchema);
    assert.equal(materials.outputSchema.type, "object");
    assert.equal("source" in materials.outputSchema.properties, true);
    assert.equal(JSON.stringify(listed).includes("ui://"), false);
  });
});

test("missing credentials are reported per provider and never as empty results", async () => {
  await withServer(async (client) => {
    const references = await client.callTool({
      name: "find_ui_references",
      arguments: { query: "billing settings", platform: "web", limit: 1 },
    });
    assert.equal(references.isError, true);
    assert.equal(references.structuredContent.error.code, "AUTH_REQUIRED");
    assert.equal(references.structuredContent.error.source, "mobbin");
    assert.match(references.structuredContent.error.message, /ui-reference-mcp auth mobbin/);

    const fonts = await client.callTool({
      name: "find_ui_materials",
      arguments: { query: "Roboto", kind: "font", limit: 1 },
    });
    assert.equal(fonts.isError, true);
    assert.equal(fonts.structuredContent.error.code, "CONFIG_REQUIRED");
    assert.equal(fonts.structuredContent.error.source, "google-fonts");
    assert.match(fonts.structuredContent.error.message, /ui-reference-mcp auth google-fonts/);
  });
});

test("semantic input combinations are rejected as INVALID_INPUT before any provider call", async () => {
  await withServer(async (client) => {
    const cases = [
      { name: "find_ui_references", arguments: { query: "pricing", platform: "ios", kind: "section" } },
      { name: "find_ui_references", arguments: { query: "onboarding", platform: "ios", kind: "flow", mode: "deep" } },
      { name: "find_ui_materials", arguments: { query: "Roboto", kind: "font", source: "iconify" } },
      { name: "find_ui_materials", arguments: { query: "credit card", kind: "icon", category: "serif" } },
      { name: "find_ui_materials", arguments: { query: "Roboto", kind: "font", prefix: "lucide" } },
    ];

    for (const call of cases) {
      const result = await client.callTool(call);
      assert.equal(result.isError, true, JSON.stringify(call));
      assert.equal(result.structuredContent.error.code, "INVALID_INPUT", JSON.stringify(call));
    }
  });
});

test("the server keeps serving protocol responses after an auth error", async () => {
  await withServer(async (client) => {
    const failed = await client.callTool({
      name: "find_ui_references",
      arguments: { query: "billing settings", platform: "web", limit: 1 },
    });
    assert.equal(failed.isError, true);

    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["find_ui_materials", "find_ui_references"]);
  });
});
