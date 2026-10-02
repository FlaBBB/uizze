# Uizze multi-source fork

**Product-specific UI with optional local reference search**

This Cursor agent package contains the fork's free `anti-ui-slop` skill and a
local stdio MCP configuration. The skill starts with the product's design
system; the optional `ui-reference` server retrieves Mobbin references or
Google Fonts and Iconify materials.

## Get started

To install the runtime, provider onboarding, skills, and global Cursor
connection, run the fork's one-command installer:

```bash
npx --yes --package 'git+https://github.com/FlaBBB/uizze.git#ui-reference-mcp-v1.0.0' ui-reference-mcp install
```

It creates the local stdio server connection under the key `ui-reference`.
Rerun `~/.local/bin/ui-reference-mcp setup` to redo provider onboarding or repair selected
global connections (the prefix may differ via `UI_REFERENCE_INSTALL_PREFIX`; with `<prefix>/bin` on `PATH`, the bare `ui-reference-mcp` name also works). This README describes the repository package; it does not
claim a Cursor marketplace listing for the fork.

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

The bundled skill declares Apache-2.0 and retains third-party notices,
including the MIT notice for identified iOS material. Keep LICENSE, NOTICE,
and MODIFICATIONS.md with the skill.
