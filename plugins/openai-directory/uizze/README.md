# Uizze multi-source fork for Codex

This package contains the free `anti-ui-slop` skill. Install it directly from
the fork:

```bash
npx skills add https://github.com/FlaBBB/uizze --skill anti-ui-slop
```

The skill works locally without an account. To optionally install and connect
the local MCP server, run:

```bash
npx --yes --package 'git+https://github.com/FlaBBB/uizze.git#ui-reference-mcp-v1.0.0' ui-reference-mcp install
```

The installer creates the global Codex stdio connection named `ui-reference`.

The default terminal binary is `~/.local/bin/ui-reference-mcp` (the prefix may differ via `UI_REFERENCE_INSTALL_PREFIX`; with `<prefix>/bin` on `PATH`, the bare `ui-reference-mcp` name also works).
The local server exposes only `find_ui_references` and `find_ui_materials`.
See the [fork's MCP guide](../../../integrations/mcp/) for provider setup,
result details, and security information.
