# Optional local UI reference MCP

The starter works without MCP. Use the bundled skill and the project's local
product context first. Add references or materials only when they would answer
a concrete unresolved design question.

## Install the local server

Run the fork's one-command installer in a terminal:

```bash
npx --yes --package 'git+https://github.com/FlaBBB/uizze.git#ui-reference-mcp-v1.0.0' ui-reference-mcp install
```

The installer sets up the local stdio runtime and globally connects omp, Codex,
Claude Code, and Cursor by default under the connection key `ui-reference`.
It does not turn the starter app into an MCP client or add a hosted endpoint.
No project `.env` variable or hand-written bearer-token setting is needed.

## Provider setup

The installer prompts for optional provider setup in the terminal:

- Mobbin uses browser consent and requires a Pro, Team, or Enterprise account.
- Google Fonts requires a Developer API key entered at the masked terminal
  prompt and validated before it is saved.
- Iconify search is public and needs no key.

Rerun `~/.local/bin/ui-reference-mcp setup` to repeat provider onboarding or repair the
global agent connections (the prefix may differ via `UI_REFERENCE_INSTALL_PREFIX`; with `<prefix>/bin` on `PATH`, the bare `ui-reference-mcp` name also works). Or configure a provider directly:

```bash
~/.local/bin/ui-reference-mcp auth mobbin
~/.local/bin/ui-reference-mcp auth google-fonts
~/.local/bin/ui-reference-mcp auth iconify
```

Credentials stay in the user's config directory, outside the starter and the
repository. Do not put API keys, tokens, or authorization codes in project
files, MCP tool inputs, or chat.

## Available tools

The local server exposes exactly two tools:

- `find_ui_references`: search Mobbin for screens, flows, or web sections and
  cite returned examples with their canonical `mobbin_url`.
- `find_ui_materials`: search Google Fonts family metadata or public Iconify
  icons; cite the returned provider `source_url` (and use `css_url` or
  `asset_url` to load the selected material).

A successful empty result is a no-match; provider or credential failures are
errors. The skill and starter remain usable when the MCP is absent or
unauthorized. See the [integration guide](../../mcp/) for exact schemas,
result shapes, and error codes. Never claim a server is connected based only on
the presence of a client configuration file.
