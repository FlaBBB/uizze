# Build better UI with your coding agent

Use these prompts on a real file or route in your project. Replace the example page with yours and give the agent the product context it needs.

## Install once

Install the skill from this fork:

```bash
npx skills add https://github.com/FlaBBB/uizze --skill ui-design
```

For a focused review of a generic UI, install `anti-ui-slop` with the same
command and `--skill anti-ui-slop`. Both skills work without an account or MCP
connection.

## Billing settings that people can use

```text
Use ui-design on our billing settings route. Make the current plan, renewal
date, payment method, and invoice history easy to scan. Separate routine
edits from canceling the subscription. Use our existing components and
tokens. Handle loading, no invoices, payment failure, and read-only access.
Inspect desktop and mobile output and fix visible breakage.
```

Check that a user can identify their plan and find the right action without reading the whole page. Keep destructive actions distinct and explain any disabled controls.

## A data table beyond the happy path

```text
Use ui-design to improve our orders table. Preserve the data and behavior.
Prioritize order status, customer, amount, and the action users take next.
Keep filters and pagination usable on small screens. Implement loading,
no orders, no filter matches, and failed loading with retry. Reuse the
project's table, input, button, and status components.
```

Treat “no records yet” and “no matches for this filter” as different states. Confirm that users can recover from both.

## Permissions without guesswork

```text
Use ui-design on our team permissions screen. Make assigned and inherited
roles distinguishable. Explain why an action is restricted and what the
user can do next. Preserve our permission logic. Cover pending invites,
expired invites, read-only users, save failures, and narrow layouts.
```

If local reference search is configured, ask a focused question such as:
“Find up to three relevant references for role inheritance and restricted
actions. Explain the decisions worth adapting to our product.”

## A focused review of a generic first draft

```text
Use anti-ui-slop on this screen. Read the product brief and existing design
system. Identify the three changes that would make this interface more
specific to our users. Implement them, finish required states, and inspect
the rendered result. Keep behavior and brand conventions intact.
```

## Native iOS refinement

```text
Use ui-design to refine this iOS settings screen. Follow the app's existing
navigation, typography, controls, and spacing. Make account and notification
preferences easy to find. Check long labels, Dynamic Type, disabled states,
and the device sizes supported by the project.
```

## Choose your agent

| Agent | How to start |
| --- | --- |
| Codex | Install `ui-design` or `anti-ui-slop` from the fork and use one of the prompts above. |
| Claude Code | Install the skill from the fork and use its skill name on a project task. |
| Cursor | Install the skill from the fork and ask the agent to use it on a named file or route. |

## Add focused local reference search

When a concrete visual question would benefit from examples, install and
connect the optional local server:

```bash
npx --yes --package 'git+https://github.com/FlaBBB/uizze.git#ui-reference-mcp-v1.0.0' ui-reference-mcp install
```

The local stdio server registers as `ui-reference` for omp, Codex, Claude Code,
and Cursor. It exposes exactly two tools: `find_ui_references` searches Mobbin
screens, flows, or web sections; `find_ui_materials` searches Google Fonts
metadata or public Iconify icons. Mobbin consent and Google Fonts key entry
happen in the terminal; Iconify needs no key. Use `~/.local/bin/ui-reference-mcp setup` to
rerun provider onboarding or repair the selected global connections (the prefix may differ via `UI_REFERENCE_INSTALL_PREFIX`; with `<prefix>/bin` on `PATH`, the bare `ui-reference-mcp` name also works).

Cite references with the result's `mobbin_url` and materials with their
provider `source_url`. If a search returns no useful evidence, continue from
the project.

For a local source check on pull requests, [inspect the Action example](pull-request-check.md).
