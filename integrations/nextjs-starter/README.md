> **Stop AI coding agents from shipping generic UI.**

# Stop Making UI Slop

Build product-specific UI with the free anti-ui-slop skill. Optional reference
and materials search uses the fork's local MCP server; see
[`docs/mcp.md`](docs/mcp.md).

## Uizze Agent UI Starter

**STOP UI SLOP before it hits `main`.**

A small, real Next.js starter for teams building interfaces with Codex, Claude
Code, Cursor, or another coding agent. It gives every agent the same product
contract, the same required UI states, and the same finish gate.

No account or MCP connection is required. The bundled skill,
design-contract workflow, and GitHub Action are free to use.

## Start in five minutes

Use Node.js 24 and npm. The complete validation runs in
[GitHub Actions](https://github.com/FlaBBB/uizze/actions/workflows/starter-validation.yml)
on changes to this starter.

Clone this fork and copy the starter:

```bash
git clone https://github.com/FlaBBB/uizze.git
cp -R uizze/integrations/nextjs-starter my-product
cd my-product
npm ci
npm run dev
```

Then:

1. Replace the example in `app/` with your product.
2. Fill in `.uizze/design-contract.md` before asking an agent to build.
3. Keep `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules/` aligned with the contract.
4. Run `npm run validate` before opening a pull request.
5. Let `.github/workflows/uizze-ui-review.yml` inspect changed frontend source.

## What is already wired

- a functional release-review screen instead of an empty dashboard shell;
- visible loading, empty, error, success, validation, and completion states;
- responsive behavior at desktop and mobile widths;
- a bundled free anti-ui-slop skill for Codex and Claude Code;
- workspace rules for Codex, Claude Code, Cursor, and GitHub Copilot;
- an explicit design-contract template and filled example;
- the published `uizze/uizze@v1` Action running inside GitHub Actions;
- deterministic checks that fail if the contract, skill, evidence, or workflow is removed.

The Action is a conservative source check. It does not upload source or claim to
replace visual review, accessibility testing, security review, or usability
testing.

## Useful commands

```bash
npm run dev
npm test
npm run type-check
npm run lint
npm run build
npm run validate
```

## The finish-gate loop

1. Define one screen job and one primary action.
2. Ground the design in real product patterns, not a generic component collage.
3. Write the hierarchy, states, responsive decisions, and forbidden patterns in
   `.uizze/design-contract.md`.
4. Build with semantic tokens and working interactions.
5. Test loading, empty, error, success, narrow, wide, keyboard, and failure paths.
6. Reject interchangeable card grids, decorative gradients, filler metrics,
   generic copy, inert controls, and missing states.

See [docs/finish-gate.md](docs/finish-gate.md) for the review checklist.

## Optional local MCP

The starter works without MCP. To install the local runtime, set up providers,
and create the global `ui-reference` stdio connection for omp, Codex, Claude
Code, and Cursor, run:

```bash
npx --yes --package 'git+https://github.com/FlaBBB/uizze.git#ui-reference-mcp-v1.0.0' ui-reference-mcp install
```

Rerun `~/.local/bin/ui-reference-mcp setup` to repeat onboarding or repair selected
connections (the prefix may differ via `UI_REFERENCE_INSTALL_PREFIX`; with `<prefix>/bin` on `PATH`, the bare `ui-reference-mcp` name also works). Use `~/.local/bin/ui-reference-mcp auth mobbin` for browser consent,
`~/.local/bin/ui-reference-mcp auth google-fonts` for the masked API-key prompt, and
`~/.local/bin/ui-reference-mcp auth iconify` for public no-key icon search. The two tools
are `find_ui_references` (Mobbin) and `find_ui_materials` (Google Fonts or
Iconify). Credentials are handled by the CLI and kept outside the project; do
not add keys or tokens to `.env` files. See [`docs/mcp.md`](docs/mcp.md) for
the provider flow and tool details.

This starter is retained from the original Uizze upstream project. Its
published Action reference and MIT license are unchanged.

## License

MIT
