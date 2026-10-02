> **Stop AI coding agents from shipping generic UI.**

# Uizze multi-source fork for Kiro

Build product-specific UI from the local product system, with optional Mobbin
references or Google Fonts and Iconify materials when they answer a concrete
question.

This is a Kiro Power for rendered web and iOS UI work. The workflow itself is
free and works without an MCP connection.

## Install

In Kiro, open **Powers** → **Add Custom Power** → **Import power from GitHub**,
then enter:

```text
https://github.com/FlaBBB/uizze
```

Kiro loads `POWER.md` on relevant UI work. To install the optional local MCP
runtime and complete provider onboarding, run this in a terminal:

```bash
npx --yes --package 'git+https://github.com/FlaBBB/uizze.git#ui-reference-mcp-v1.0.0' ui-reference-mcp install
```

The installer configures omp, Codex, Claude Code, and Cursor globally; it does
not auto-configure Kiro. If Kiro is connected through its local stdio MCP
support, use connection key `ui-reference` and launch the installed
`~/.local/bin/ui-reference-mcp` server (the prefix may differ via `UI_REFERENCE_INSTALL_PREFIX`; with `<prefix>/bin` on `PATH`, the bare `ui-reference-mcp` name also works). See [`../mcp/`](../mcp/) for provider setup and tool
contracts. There is no hosted MCP endpoint.

## What it does

- Starts with the product's actual UI system before choosing a layout.
- Uses `find_ui_references` or `find_ui_materials` only for a concrete need.
- Treats an empty successful result as a no-match and provider failures as errors.
- Inspects the rendered result once when the environment supports it.

The power never copies another product's visual identity, text, imagery, or
exact layout. It does not make accessibility, security, correctness, or
conversion guarantees.

## Source

Maintained by FlaBBB in the [Uizze multi-source fork](https://github.com/FlaBBB/uizze).
