# Uizze multi-source fork

Build interfaces that fit your product. This repository includes three focused
agent skills and an optional local stdio MCP server for Mobbin UI references,
Google Fonts metadata, and Iconify icons.

[![CI](https://github.com/FlaBBB/uizze/actions/workflows/ci.yml/badge.svg)](https://github.com/FlaBBB/uizze/actions/workflows/ci.yml)
[![Licenses: MIT and Apache-2.0](https://img.shields.io/badge/Licenses-MIT_%2F_Apache--2.0-black.svg)](LICENSING.md)

[Try a workflow](examples/agent-workflows.md) · [Try one screen](examples/first-screen.md) · [Local MCP guide](integrations/mcp/) · [GitHub Action](integrations/github-action/)

## Start with a skill

Install the skill that fits the task from this fork:

```bash
npx skills add https://github.com/FlaBBB/uizze --skill ui-design
```

For a focused review of a generic draft, install `anti-ui-slop`:

```bash
npx skills add https://github.com/FlaBBB/uizze --skill anti-ui-slop
```

For focused UI reference research, install `ui-radar`:

```bash
npx skills add https://github.com/FlaBBB/uizze --skill ui-radar
```

These skills work without an account or MCP connection. Start in an existing
project: its brief, components, and design system guide the work.

| Task | Skill | Focus |
| --- | --- | --- |
| Build or redesign an interface | [`ui-design`](skills/ui-design) | Product-specific hierarchy, interactions, and states |
| Improve a generic first draft | [`anti-ui-slop`](skills/anti-ui-slop) | Specific content, deliberate layouts, and a finish review |
| Investigate a UI decision | [`ui-radar`](skills/ui-radar) | Focused reference research; optionally use the local MCP |

For example:

```text
Use ui-design to improve our billing settings page. Make the current plan,
payment method, and invoices easy to scan. Reuse our components and design
tokens. Include loading, empty, error, and permission states. Inspect the
result at desktop and mobile sizes and fix what breaks.
```

## Add optional local references and materials

When a concrete design question needs outside evidence, install the local
`ui-reference-mcp` runtime and connect it globally:

```bash
npx --yes --package 'git+https://github.com/FlaBBB/uizze.git#ui-reference-mcp-v1.0.0' ui-reference-mcp install
```

The installer targets omp, Codex, Claude Code, and Cursor by default. It sets
up the local stdio connection named `ui-reference`, the runtime, and selected
skills. Mobbin authorization and Google Fonts API-key entry happen in the
terminal; Iconify needs no key. Rerun `~/.local/bin/ui-reference-mcp setup` to redo provider
onboarding or repair selected connections (the prefix may differ via `UI_REFERENCE_INSTALL_PREFIX`; with `<prefix>/bin` on `PATH`, the bare `ui-reference-mcp` name also works). Use `~/.local/bin/ui-reference-mcp install --skip-auth` for the free skills and runtime without provider authorization.
Credentials stay in the user config directory, not in a project or chat.

The server exposes exactly two tools:

| Tool | Source | Use |
| --- | --- | --- |
| `find_ui_references` | Mobbin | Search up to three web or iOS screens, flows, or web sections |
| `find_ui_materials` | Google Fonts or Iconify | Search font catalog metadata or public icon sets |

References are optional: use a returned `mobbin_url` as the reference citation.
For materials, cite the provider `source_url`; use `css_url` for Google Fonts
and `asset_url` for an Iconify SVG. A successful empty result is a no-match;
provider and credential failures are reported as errors. See
[`integrations/mcp/`](integrations/mcp/) for exact input schemas, errors,
result fields, and onboarding details. This fork does not provide a remote MCP
endpoint.

## Use it where you already build

| Environment | Start here |
| --- | --- |
| Codex, Claude Code, Cursor | [Install and try a workflow](examples/agent-workflows.md) |
| omp | [Local MCP onboarding](integrations/mcp/) |
| GitHub pull requests | [UI Slop Gate Action](integrations/github-action/) · [Inspect the example output](examples/pull-request-check.md) |

## Catch unfinished UI in pull requests

The UI Slop Gate checks changed frontend source for inert controls, missing
state markers, hardcoded colors, and combinations of generic dashboard cues.
Findings appear next to the code and in the workflow summary.

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@v7
    with:
      fetch-depth: 2
      persist-credentials: false
  - uses: uizze/uizze@v1
    with:
      fail-on: error
```

The action shown above is a previously published upstream artifact, separate
from this fork's local MCP. It requires no account, API key, or source upload.
See the [published Action example](https://github.com/uizze/uizze/actions/workflows/ui-slop-gate-example.yml)
and [complete workflow guide](integrations/github-action/#usage).

## Use the local finish gate

The [Codex finish-gate integration](integrations/codex-finish-gate/) provides a
separate billing-settings exercise and a deterministic verifier. It is a
published upstream integration retained in this repository; it does not add a
hosted MCP review service.

## Explore this fork

- [Agent workflows](examples/agent-workflows.md): billing settings, data tables, permissions, and native iOS.
- [First-screen exercise](examples/first-screen.md): a worked billing-settings task.
- [Next.js starter](integrations/nextjs-starter/): a product-specific starting point.
- [Storybook integration](integrations/storybook/): review UI states alongside components.
- [Maintained distribution paths](DISTRIBUTION.md).
- [Design contract](DESIGN.md).

## License

Repository code and text use [MIT](LICENSE) unless a more specific notice
applies. Bundled skill playbooks retain their Apache-2.0 license and
third-party notices. See [the license map](LICENSING.md) before redistributing
a skill package.
