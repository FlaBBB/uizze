---
name: anti-ui-slop
description: Stop coding agents from shipping generic UI. Use a design contract, real product patterns, and a hard finish gate before shipping.
---

# STOP UI SLOP

This local workflow is useful without provider credentials or an MCP connection.

## Workflow

1. Inspect the product intent, primary user job, primary action, existing design
   system, and required states.
2. Use the host-namespaced `find_ui_references` on the optional `ui-reference`
   connection for Mobbin screens, flows, or web sections; use
   `find_ui_materials` for Google Fonts or Iconify only when they answer a
   concrete question. Inspect returned images before visual claims and cite
   Mobbin's returned `mobbin_url`. Missing access or a no-match is not a reason
   to browse an unauthorized catalogue; continue with local design judgment.
3. Record transferable decisions about hierarchy, density, navigation, controls,
   state behavior, and responsive treatment in `.uizze/design-contract.md`.
4. Build with the repository's existing tokens and components. Make the result
   belong to this product.
5. Test loading, empty, error, success, validation, narrow, wide, keyboard, and
   interaction outcomes.
6. Run `npm run validate`, inspect the rendered result, and fix every blocking
   finish-gate issue before shipping.

Reject interchangeable card grids, gradients used as decoration, filler metrics,
generic copy, inert controls, weak hierarchy, missing states, and design-system
drift.

## Optional MCP

The local workflow is complete without the MCP. When a concrete question needs
external evidence, use available host-namespaced tools on `ui-reference`.
Mobbin requires an authorized Pro, Team, or Enterprise account; Google Fonts
requires the user's own Developer API key. Missing access blocks only that
provider.

Run `~/.local/bin/ui-reference-mcp auth mobbin` or
`~/.local/bin/ui-reference-mcp auth google-fonts` in the terminal; never ask
for keys or tokens in chat. The prefix defaults to `~/.local`; if
`UI_REFERENCE_INSTALL_PREFIX` sets another prefix, use
`<prefix>/bin/ui-reference-mcp`. Adding `<prefix>/bin` to `PATH` lets the bare
command name work. Do not claim a connection that does not exist or block work
without MCP.
