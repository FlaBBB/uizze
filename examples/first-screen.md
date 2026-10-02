# Try one screen

Take a billing settings page from your project and give your coding agent one
specific task. You'll check the current plan, payment details, invoices, and
the states users encounter when something goes wrong.

This billing exercise is a separate walkthrough you can run in your own project.

## Choose a starting point

Open your project in Claude Code, Cursor, or GitHub Copilot and identify the
billing route or component. Keep the existing design system and billing logic.

If you need a practice project, copy our small HTML/CSS/JavaScript seed:

```bash
git clone --depth 1 https://github.com/FlaBBB/uizze.git uizze-examples
cp -R uizze-examples/integrations/benchmark/site/recordings/billing-settings-v1/seed uizze-first-screen
cd uizze-first-screen
```

The seed provides an unfinished billing page for a fictional product and has no dependencies to install.
Its interface lives in `index.html`, `styles.css`, and `app.js`. Use Node.js
to run its source check with `npm run verify`. The initial seed fails this check
because you haven't implemented the page yet. The check looks for required
terms and CSS variables; you'll inspect behavior in the browser too.

## Install in your agent

Install the skill from this fork:

```bash
npx skills add https://github.com/FlaBBB/uizze --skill anti-ui-slop
```

Ask your agent to use `anti-ui-slop` with the brief below. The same skill-only
install works for Claude Code, Cursor, and other compatible coding agents.

## Give the agent this brief

Name your actual route or component before pasting this:

```text
Use anti-ui-slop to improve this billing settings page.

Read the existing components and design tokens first. Make the current plan,
renewal date, payment method, and invoice history easy to scan. Separate
routine edits from canceling the subscription. Preserve billing behavior.

Cover loading, no invoices, payment failure with retry, and a successful
update. Make the primary action clear at both desktop and mobile widths.
Use the product's own content and visual language.

Inspect the rendered result, fix clipping and inert controls, and tell me
which states you verified and anything you couldn't check.
```

For the practice seed, add: “Implement the unfinished billing page using fictional
example data. Only change `index.html`, `styles.css`, and `app.js`. Implement
`?state=default|loading|empty|failed|success` using the existing state parameter
and run `npm run verify` without changing the verifier.”

## Bring real product references into the task

The skill works on its own. When a concrete design question would benefit from
reference search or materials, install and connect the local MCP server:

```bash
npx --yes --package 'git+https://github.com/FlaBBB/uizze.git#ui-reference-mcp-v1.0.0' ui-reference-mcp install
```

This installs and globally connects the local stdio server as `ui-reference`
for omp, Codex, Claude Code, and Cursor. It exposes exactly two tools:
`find_ui_references` for Mobbin screens, flows, or web sections, and
`find_ui_materials` for Google Fonts metadata or public Iconify icons. Mobbin
uses browser consent, Google Fonts key entry happens in a masked terminal
prompt, and Iconify needs no key. Run `~/.local/bin/ui-reference-mcp setup` to rerun setup (the prefix may differ via `UI_REFERENCE_INSTALL_PREFIX`; with `<prefix>/bin` on `PATH`, the bare `ui-reference-mcp` name also works).

Use a reference prompt such as:

```text
Before implementing, use find_ui_references to find up to three relevant web
screen references for billing settings with invoice history. Explain the
hierarchy, density, and responsive table decisions worth adapting. Implement
those decisions with our components and brand. Cite each reference with its
returned mobbin_url. If no relevant references return, continue from the project.
```

## Check the result

Run your project's normal development server. For the practice seed, run this
in a separate terminal from `uizze-first-screen`:

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/index.html?state=default` and try each state value.
Check desktop and narrow mobile widths:

- Can you find the current plan, payment method, and next action at a glance?
- Can you recover from a failed operation and distinguish it from no invoices?
- Do the controls work, and can you reach them with a keyboard?
- Do long invoice labels and amounts fit without hiding useful information?

Keep a screenshot before and after, the prompt, and any remaining problems.
If you share the result, identify the agent and model you used and whether
you connected MCP.

[More tasks: tables, permissions, and native iOS](agent-workflows.md)
