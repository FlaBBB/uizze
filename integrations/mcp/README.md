# UI Reference MCP

This fork provides a local stdio MCP server for optional UI reference and material search. It exposes exactly two tools: `find_ui_references` (Mobbin) and `find_ui_materials` (Google Fonts or Iconify). There is no hosted HTTP MCP endpoint; cloud-only remote clients cannot run this server.

## Install and connect

The one-command installer sets up the durable local runtime, skills, provider onboarding, and global agent connections. Node.js 24 or newer is required.

```bash
npx --yes --package 'git+https://github.com/FlaBBB/uizze.git#ui-reference-mcp-v1.0.0' ui-reference-mcp install
```
The durable terminal binary is `<prefix>/bin/ui-reference-mcp` (by default, `~/.local/bin/ui-reference-mcp`). Set `UI_REFERENCE_INSTALL_PREFIX` to choose a different prefix; the installer prints the exact path. The bare `ui-reference-mcp` name works only when `<prefix>/bin` is on `PATH`.

Installation is global by default and targets omp, Codex, Claude Code, and Cursor. It installs or reuses the requested skills, then writes the local `ui-reference` stdio connection for the selected agent targets. It does not install the agent applications themselves. Credentials are saved in the user config directory (by default `~/.config/ui-reference-mcp`, or `${XDG_CONFIG_HOME}/ui-reference-mcp` when `XDG_CONFIG_HOME` is set), never in the repository or chat.

The installer prompts locally when authorization is needed:

- Mobbin opens a browser consent flow and returns to a loopback callback. Reference search requires a Mobbin Pro, Team, or Enterprise account.
- Google Fonts asks for a Developer API key in a masked terminal prompt and validates it before saving. Do not pass the key in a command argument or put it in an MCP request.
- Iconify is public and requires no key.

Rerun provider onboarding or repair selected global connections without reinstalling skills:

```bash
~/.local/bin/ui-reference-mcp setup
```

Use `~/.local/bin/ui-reference-mcp auth mobbin`, `~/.local/bin/ui-reference-mcp auth google-fonts`, or `~/.local/bin/ui-reference-mcp auth iconify` to configure or check one provider directly. The Google Fonts command also accepts `--stdin` for an explicitly managed noninteractive input stream. `~/.local/bin/ui-reference-mcp auth` without a provider opens the provider selector. `~/.local/bin/ui-reference-mcp install --skip-auth` installs the free skills and runtime without authenticating providers; references or fonts that need missing credentials remain unavailable, while Iconify needs no credential.

Global connection files written by the installer:

| Agent | User configuration file |
| --- | --- |
| omp | `~/.omp/agent/mcp.json` under the active omp profile |
| Codex | `$CODEX_HOME/config.toml`; default `~/.codex/config.toml` |
| Claude Code | `~/.claude.json`, or `$CLAUDE_CONFIG_DIR/.claude.json` when relocated |
| Cursor | `~/.cursor/mcp.json` |

The server runs over local stdio using connection key `ui-reference`. To reload a changed connection, refresh or restart the agent as appropriate; no server URL, bearer token, or manual credential environment variable is used.

## Tool contracts

Both tools reject unknown fields. Queries are trimmed and must be nonempty. `limit` is an integer from 1 through 3 and defaults to `3`.

### `find_ui_references`

| Field | Required | Values / default |
| --- | --- | --- |
| `query` | yes | Nonempty string after trimming |
| `platform` | yes | `ios` or `web` |
| `kind` | no | `screen`, `flow`, or `section`; defaults to `screen` |
| `source` | no | `mobbin`; defaults to `mobbin` |
| `limit` | no | Integer `1`–`3`; defaults to `3` |
| `mode` | no | `standard` or `deep`; screens only, defaults to `standard` |
| `task_intent` | no | Nonempty string after trimming |

Sections are web-only. `mode` is valid only for screens. Results preserve Mobbin's native MCP text and image content plus its structured metadata; there is no promised normalized reference-item schema. Cite a result using its canonical `mobbin_url`, not an invented URL or a preview image link.

### `find_ui_materials`

| Field | Required | Values / default |
| --- | --- | --- |
| `query` | yes | Nonempty string after trimming |
| `kind` | yes | `font` or `icon` |
| `source` | no | `google-fonts` for fonts; `iconify` for icons |
| `limit` | no | Integer `1`–`3`; defaults to `3` |
| `category` | no | Fonts only: `serif`, `sans-serif`, `monospace`, `display`, or `handwriting` |
| `prefix` | no | Icons only: lowercase icon-set slug matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`, such as `lucide` |

An explicit source must match the requested kind. `category` is rejected for icons; `prefix` is rejected for fonts. Font results contain `id`, `family`, `category`, `variants`, `subsets`, `source_url`, `css_url`, and `files`. Font matching searches Google Fonts catalog metadata; the API does not provide a license record, so check the linked Google Fonts family page before redistribution. Cite the family `source_url`; use `css_url` when loading the font.

Icon results contain `id` (`prefix:name`), `name`, `collection`, `source_url`, and `asset_url`, plus `author` and `license` only when Iconify returns that metadata. Cite the Iconify set `source_url`; the `asset_url` links to its SVG asset. Neither provider's assets are bundled or proxied.

Successful material results have this discriminated shape (with the corresponding source and kind for icons):

```json
{
  "source": "google-fonts",
  "kind": "font",
  "results": []
}
```

The `results` array items have these exact fields:

- Font: `{ id: string, family: string, category: string, variants: string[], subsets: string[], source_url: string, css_url: string, files: Record<string, string> }`.
- Icon: `{ id: string, name: string, collection: string, source_url: string, asset_url: string, author?: { name: string, url?: string }, license?: { title: string, spdx?: string, url?: string } }`.

The returned material object is available as `structuredContent` and as a JSON string in the text content.

An empty `results` array is a valid no-match, not a provider error.

## Errors

Wrapper-generated tool errors set `isError: true`, include a text JSON body, and provide structured content in this form:

```json
{
  "error": {
    "code": "CONFIG_REQUIRED",
    "source": "google-fonts",
    "message": "A safe, actionable error message"
  }
}
```

The available codes are:

- `AUTH_REQUIRED`: Mobbin login is missing, expired, or rejected.
- `CONFIG_REQUIRED`: provider credentials are missing or cannot be read safely.
- `PROVIDER_ERROR`: a provider request, response, or credential refresh failed.
- `INVALID_INPUT`: fields or field combinations are not supported.

HTTP, network, malformed-response, or credential failures are errors, never empty matches. Mobbin's native provider errors remain errors with their returned safe message. See the [Mobbin MCP features](https://docs.mobbin.com/mcp/features.md), [Google Fonts Developer API](https://developers.google.com/fonts/docs/developer_api), [Google Fonts CSS API](https://developers.google.com/fonts/docs/css2), and [Iconify API](https://iconify.design/docs/api/search.html) for provider details.

## Development

Source, package scripts, and the local stdio server are maintained in this directory. For contribution and security guidance, see [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
