# Uizze multi-source fork

**Product-specific UI with optional local reference search**

This Antigravity custom plugin package keeps the fork's free `anti-ui-slop`
skill and local stdio MCP configuration. The optional `ui-reference`
connection searches Mobbin for references and uses Google Fonts or Iconify for
materials.

## Get started

Copy this package to `.agents/plugins/uizze/` in your project, or to
`~/.gemini/config/plugins/uizze/` for all projects. Keep its `skills/`,
`assets/`, `plugin.json`, and `mcp_config.json` together. The MCP configuration
uses the local `ui-reference` server; no hosted endpoint or remote OAuth flow
is required.

Install the local runtime and provider onboarding from the fork:

```bash
npx --yes --package 'git+https://github.com/FlaBBB/uizze.git#ui-reference-mcp-v1.0.0' ui-reference-mcp install
```

The installer automatically configures omp, Codex, Claude Code, and Cursor; it
does not auto-configure Antigravity. To use this package's MCP entry, the host
must launch the installed `~/.local/bin/ui-reference-mcp` executable as a local stdio
server (the prefix may differ via `UI_REFERENCE_INSTALL_PREFIX`; with `<prefix>/bin` on `PATH`, the bare `ui-reference-mcp` name also works).

## Try it

> Help me ground a new interface in my product's design system, using focused Mobbin references only if they answer a concrete question.

> Find strong full-screen UI references for this unresolved interface question.

> Run the bounded UI finish gate on my rendered interface.

## Skill and MCP

The free skill includes its playbooks and licensing notices. It works without
an account or MCP connection. The optional local MCP exposes exactly
`find_ui_references` and `find_ui_materials`. Mobbin reference search requires
browser authorization; Google Fonts requires a key entered in the masked
terminal prompt; Iconify needs no key.

The skill's finish gate uses the agent's local inspection and rendering
capabilities. No hosted review tool is included. Cite reference results with
their returned `mobbin_url` and material results with the provider
`source_url`.

[Fork repository](https://github.com/FlaBBB/uizze) · [Local MCP setup](../../integrations/mcp/)

## License

Maintained from [FlaBBB/uizze](https://github.com/FlaBBB/uizze/tree/main/plugins/antigravity).

The bundled skill declares Apache-2.0 and retains third-party notices,
including the MIT notice for identified iOS material. Keep LICENSE, NOTICE,
and MODIFICATIONS.md with the skill.

Packaging follows the [Antigravity plugin documentation](https://antigravity.google/docs/plugins).
