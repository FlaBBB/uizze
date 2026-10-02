> **Stop AI coding agents from shipping generic UI.**

# Stop Making UI Slop

The free Storybook finish gate helps reviewers check product-specific
contracts. It is useful on its own; optional references and materials are
retrieved separately through the fork's local MCP server.

## Uizze Finish Gate for Storybook

**STOP UI SLOP before the component library makes it permanent.**

`storybook-addon-uizze` adds a local finish-gate panel to every selected
Storybook story. It turns the story's job, primary action, real interface
references, required states, rejected patterns, and acceptance criteria into
a visible contract reviewers can enforce.

The addon is local. It does not transmit source, DOM, screenshots, args, story
metadata, or analytics. It does not retrieve reference material by itself;
`references` are explicit URLs supplied with the story contract.

## Install

Install the verified GitHub release package:

```sh
npm install --save-dev https://github.com/uizze/uizze/releases/download/storybook-v0.1.2/storybook-addon-uizze-0.1.2.tgz
```

The package is not on npm. Verify the downloaded archive against the matching
[SHA-256 checksum](https://github.com/uizze/uizze/releases/download/storybook-v0.1.2/storybook-addon-uizze-0.1.2.tgz.sha256)
when your dependency policy requires it.

Add the package to `.storybook/main.ts`:

```ts
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  addons: ['storybook-addon-uizze'],
};

export default config;
```

Storybook 9 and 10 are supported. The first tested framework is React with
Vite; other framework claims are added only after their build fixtures pass.

## Put a finish contract on a story

```ts
import type { Meta } from '@storybook/react-vite';
import { ReleaseReview } from './ReleaseReview';

const meta: Meta<typeof ReleaseReview> = {
  component: ReleaseReview,
  parameters: {
    uizze: {
      screenJob: 'Let a reviewer approve a release without losing risk context.',
      primaryAction: 'Approve release',
      references: [
        {
          label: 'Mobbin release-workflow reference',
          url: 'https://mobbin.com',
          note: 'Example only: replace with a matching result’s canonical mobbin_url.',
        },
      ],
      requiredStates: ['ready', 'loading', 'empty', 'error', 'permission denied'],
      forbiddenPatterns: ['Filler metrics', 'Equal-weight card grid', 'Inert secondary actions'],
      acceptanceCriteria: [
        'Keyboard focus reaches the primary action before secondary metadata.',
        'Every failure preserves enough context to recover.',
      ],
    },
  },
};

export default meta;
```

Open the **UIZZE Finish Gate** panel. A story passes only when it documents:

- the user outcome and primary action;
- at least one valid `http` or `https` interface reference;
- ready, loading, empty, and error states;
- the generic patterns this story must reject;
- an observable rendered or behavioral acceptance criterion.

Replace the example URL with a real interface reference before relying on the
contract. The panel can copy the normalized contract as Markdown for a PR or
design-review record.

## Parameter API

| Field                | Type                      | Meaning                                                                                |
| -------------------- | ------------------------- | -------------------------------------------------------------------------------------- |
| `disable`            | `boolean`                 | Disable the finish gate for one story.                                                 |
| `screenJob`          | `string`                  | The user outcome the screen must make possible.                                        |
| `primaryAction`      | `string`                  | The single action the hierarchy must protect.                                          |
| `references`         | `{ label, url, note? }[]` | Real interface evidence and why it matters. Only `http` and `https` URLs are accepted. |
| `requiredStates`     | `string[]`                | States reviewers must see. Defaults to ready, loading, empty, and error.               |
| `forbiddenPatterns`  | `string[]`                | Product-inappropriate patterns that fail the review.                                   |
| `acceptanceCriteria` | `string[]`                | Observable behaviors or rendered results required to finish.                           |

Inputs are bounded before rendering or Markdown export: at most 12 items per
list, 240 characters per text value, and 2,048 characters per URL.

## Privacy and security

- No background network calls, telemetry, cookies, or local storage.
- No story source, DOM, screenshots, args, parameters, or metadata leave Storybook.
- External navigation and clipboard access happen only after an explicit click.
- Reference URLs must parse as `http` or `https`; `javascript:` and other active schemes are rejected.
- Links open with `noopener noreferrer`; content is rendered through React without raw HTML.
- The addon does not change the builder, preview, framework, or remote-script configuration.

For security coordination on this fork, follow the [root security policy](../../SECURITY.md).

## Optional local reference and material search

The addon itself only records and displays URLs supplied in story parameters.
To search for evidence, install and connect the fork's local stdio server:

```bash
npx --yes --package 'git+https://github.com/FlaBBB/uizze.git#ui-reference-mcp-v1.0.0' ui-reference-mcp install
```

The global connection key is `ui-reference` for omp, Codex, Claude Code, and
Cursor. Run `~/.local/bin/ui-reference-mcp setup` to repeat provider onboarding or repair selected
connections (the prefix may differ via `UI_REFERENCE_INSTALL_PREFIX`; with `<prefix>/bin` on `PATH`, the bare `ui-reference-mcp` name also works). Provider-specific commands are `~/.local/bin/ui-reference-mcp auth mobbin`
(browser consent), `~/.local/bin/ui-reference-mcp auth google-fonts` (masked key
prompt), and `~/.local/bin/ui-reference-mcp auth iconify` (public, no key).

`find_ui_references` searches Mobbin screens, flows, and web sections. Add a
matching result's canonical `mobbin_url` to the story's `references` array.
`find_ui_materials` searches Google Fonts metadata or public Iconify icons;
cite material results with the provider `source_url`. See
[`integrations/mcp/`](../mcp/) for exact tool contracts and results. The
server is local and separate from the Storybook addon.

This addon and its GitHub release are retained as published upstream
artifacts; the upstream repository and package identifier remain unchanged.

## License

MIT
