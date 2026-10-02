# Uizze multi-source fork packages

**UI design workflow with Mobbin references and Google Fonts/Iconify materials**

This fork packages the three free skills (`anti-ui-slop`, `ui-design`, `ui-radar`) together with its own local stdio MCP server. Machine identifiers such as `uizze` and the skill names stay stable as lineage; the human display name is **Uizze multi-source fork**, maintained by [FlaBBB](https://github.com/FlaBBB).

- [[CC]](claude-directory/): the complete anti-ui-slop skill plus a local stdio `ui-reference` server entry.
- [Cursor](cursor-agent/): the same skill and the same local `ui-reference` entry in Cursor's MCP format.
- [Gemini CLI](gemini-cli/): the same skill and a `ui-reference` command entry.
- [Antigravity](antigravity/): the same skill and a `ui-reference` command entry.
- [[OI] package source](openai-directory/uizze/): source packaging for the same skill and server.
- Other hosts: [the fork's MCP integration guide](../integrations/mcp/).

Checked-in connection entries are portable examples that assume the bare `ui-reference-mcp` name resolves on `PATH` (the default binary is `~/.local/bin/ui-reference-mcp`; the prefix may differ via `UI_REFERENCE_INSTALL_PREFIX`, and putting `<prefix>/bin` on `PATH` allows the bare name). The supported path is the one-command installer, which writes an absolute Node launcher plus the durable CLI path for omp, Codex, [CC], and Cursor:

```bash
npx --yes --package 'git+https://github.com/FlaBBB/uizze.git#ui-reference-mcp-v1.0.0' ui-reference-mcp install
```

Provider credentials are owned by the local server's user configuration directory, never by these packages or repository files. `find_ui_references` needs an authorized Mobbin Pro/Team/Enterprise account; `find_ui_materials` needs the user's own Google Fonts Developer API key for fonts and no key for public Iconify icons.

There is no plugin verifier script in this fork; plugin consistency is checked by the JSON validity and skill checksum steps in [the root CI workflow](../.github/workflows/ci.yml) and by the MCP backend job.

## Skill workflow

The bundled packages include the complete 16-file anti-ui-slop bundle with eight playbooks, including craft and optional Overdrive. With the skill available, ask “Use Uizze Overdrive on this screen.” The router recognizes that request and requires a chosen direction before implementation. This release adds no native `/overdrive` command registration.

## Platform differences

Machine identifiers such as `uizze`, established plugin IDs, and existing environment-variable names stay stable. Platforms require different manifest keys and category identifiers. Each package uses the current complete canonical skill with its licenses and playbooks.

Third-party attribution, license files, and notices are retained unchanged. This fork does not claim the upstream hosted service, its registry or marketplace listings, or its published support and privacy pages.
