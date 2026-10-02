---
name: ui-design
description: Design, build, or improve web and mobile interfaces using the local product and design system, focused Mobbin references, and Google Fonts or Iconify materials. Use for UI design, UX design, frontend and mobile layouts, design systems, redesigns, visual polish, and interface critique.
license: Apache-2.0
metadata:
  uizze-version: uizze-design-v13
  design-stack-version: 4.4.0
---

# Uizze UI Design

## Work from the product

Read the brief, existing UI, components, tokens, assets, and any PRODUCT.md or DESIGN.md before designing. The user's request and project constraints outrank this skill. Preserve an established visual system for extensions and polish; replace it only for an approved redesign. A new project does not require those files.

Identify the audience, primary task, important states, and intended result. Ask only about missing choices that would materially change the work. A precise request is enough to proceed; do not turn a small fix into a discovery workshop.

## Select the workflow

Load the playbook for the requested action, plus the platform and craft guidance needed to execute it:

- New interface or major redesign: [new-work](reference/new-work.md)
- Product or dashboard work: [operate](reference/operate.md)
- Refinement and polish: [polish](reference/polish.md)
- Simplification: [distill](reference/distill.md)
- Explicit audit: [audit](reference/audit.md), read-only unless fixes were requested
- Native iOS: [iOS](reference/ios.md), alongside the action's playbook
- Explicit `/overdrive`, “Uizze Overdrive”, or a request for exceptional interaction work: [Overdrive](reference/overdrive.md)

For implementation, use [craft](reference/craft.md) after the direction is settled. Load only relevant files; multiple complementary playbooks are allowed. Overdrive is opt-in, not the default for ordinary UI work. It requires a chosen direction before implementation.

“Use Uizze Overdrive on this screen” works through this router; a native slash command depends on the host. These are self-contained Markdown playbooks, not an installer, background service, or executable engine.

## Optional UI evidence

Read [the reference policy](references/ui-reference-policy.md) before using `find_ui_references` or `find_ui_materials`. Inspect relevant visual evidence when it can inform the layout, state, interaction, or assets. Use the host's available namespaced tool names on the `ui-reference` connection; do not invent calls or connections.

Distinguish a useful match, a related example, no match, and a provider error. Briefly disclose a limitation that affected the result. Never claim an image was inspected or a state was found without evidence.

## Terminal onboarding

Install the optional local MCP with:

```sh
npx --yes --package 'git+https://github.com/FlaBBB/uizze.git#ui-reference-mcp-v1.0.0' ui-reference-mcp install
```

Mobbin authorization uses browser consent; Google Fonts keys are entered in a masked terminal prompt. For a free setup without provider credentials, use `~/.local/bin/ui-reference-mcp install --skip-auth`; provider status may remain “not configured.” Rerun setup with `~/.local/bin/ui-reference-mcp setup`, or recover access in the terminal with `~/.local/bin/ui-reference-mcp auth mobbin` or `~/.local/bin/ui-reference-mcp auth google-fonts` (`~/.local/bin/ui-reference-mcp auth iconify` needs no key). The connection key is `ui-reference`; host tools may appear under host-specific namespaced names.
The prefix defaults to `~/.local`; if `UI_REFERENCE_INSTALL_PREFIX` sets another prefix, use `<prefix>/bin/ui-reference-mcp` instead. Adding `<prefix>/bin` to `PATH` lets the bare command name work. Ordinary UI tasks must not trigger automatic authentication, downloads, or browser prompts.

## Finish

Build the requested scope and exercise its important states. Render and inspect the real result at representative desktop/mobile sizes or native device classes, including the user's reported failing size. Compare it with the chosen direction or supplied reference, not just with the absence of runtime errors.

Fix material problems in a batch, then render and inspect again. Stop once the requested result is verified; do not keep inventing work. If a bounded pass cannot resolve an issue, report it instead of claiming a pass. When rendering is unavailable, distinguish code checks from visual verification.

Keep the handoff concise: what changed, what was actually tested, and any remaining limitation. A skill does not authorize publishing, purchases, new dependencies, account changes, or destructive actions.
