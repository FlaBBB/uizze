# Uizze multi-source fork

**Product-specific UI with optional local reference search**

This Gemini CLI extension package keeps the fork's free `anti-ui-slop` skill
and its local stdio MCP configuration. The optional `ui-reference` connection
searches Mobbin for references and uses Google Fonts or Iconify for materials.

## Get started

Install the local runtime and provider onboarding from the fork:

```bash
npx --yes --package 'git+https://github.com/FlaBBB/uizze.git#ui-reference-mcp-v1.0.0' ui-reference-mcp install
```

The installer automatically registers omp, Codex, Claude Code, and Cursor; it
does not register Gemini CLI. This package uses the local `ui-reference`
stdio server when loaded by a client configured to launch the installed
`~/.local/bin/ui-reference-mcp` executable (the prefix may differ via `UI_REFERENCE_INSTALL_PREFIX`; with `<prefix>/bin` on `PATH`, the bare `ui-reference-mcp` name also works). No remote extension URL or hosted MCP endpoint
is used.

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

Maintained from [FlaBBB/uizze](https://github.com/FlaBBB/uizze/tree/main/plugins/gemini-cli).

The bundled skill declares Apache-2.0 and retains third-party notices,
including the MIT notice for identified iOS material. Keep LICENSE, NOTICE,
and MODIFICATIONS.md with the skill.
