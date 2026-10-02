---
name: "uizze-ui-slop"
displayName: "Uizze multi-source fork"
description: "Build product-specific UI with the local product system and optional Mobbin references or Google Fonts/Iconify materials."
keywords: ["ui design", "frontend ui", "interface", "screen", "design system", "responsive ui", "ui review"]
author: "FlaBBB"
---

# Build from the product

Use this power for rendered web or iOS interface work. Read the product brief,
existing components, tokens, and constraints before choosing a layout.

The free workflow needs no account or MCP connection. The optional local
`ui-reference-mcp` server exposes `find_ui_references` and
`find_ui_materials`. Reference search uses Mobbin; material search uses Google
Fonts for fonts and Iconify for icons. Retrieve them only when they answer a
concrete unresolved question. An empty result is a no-match.

## Workflow

1. Identify the screen job, primary action, product objects, and important states.
2. Preserve the existing visual language and familiar interaction conventions.
3. Retrieve at most a few focused references or materials when they are useful.
4. Build the requested scope without filler metrics, inert controls, or a new
   design system.
5. Render and inspect once when the environment supports it. Fix observable
   clipping, overlap, broken controls, inaccessible interaction, or distorted media.

Never copy another product's branding, proprietary text, imagery, or exact
layout. Retrieved evidence does not replace accessibility, security,
correctness, or usability review.

## Optional local MCP

Install the local server and run provider onboarding from a terminal:

```bash
npx --yes --package 'git+https://github.com/FlaBBB/uizze.git#ui-reference-mcp-v1.0.0' ui-reference-mcp install
```

The installer automatically configures omp, Codex, Claude Code, and Cursor; it
does not auto-configure Kiro. If Kiro is connected through its local stdio MCP
support, use connection key `ui-reference` and launch the installed
`~/.local/bin/ui-reference-mcp` server (the prefix may differ via `UI_REFERENCE_INSTALL_PREFIX`; with `<prefix>/bin` on `PATH`, the bare `ui-reference-mcp` name also works). See the [local MCP guide](../mcp/) for the provider
auth flow and exact tool schemas.
