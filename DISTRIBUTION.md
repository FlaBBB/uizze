# Fork distribution

This fork is maintained at [FlaBBB/uizze](https://github.com/FlaBBB/uizze).
The maintained distribution paths in the fork are the repository itself,
`skills/`, and the local MCP integration at `integrations/mcp/`.

## Maintained install paths

Install an individual skill directly from the fork:

```bash
npx skills add https://github.com/FlaBBB/uizze --skill ui-design
```

Use the local backend's one-command installer for runtime, skills, provider
onboarding, and global agent connections:

```bash
npx --yes --package 'git+https://github.com/FlaBBB/uizze.git#ui-reference-mcp-v1.0.0' ui-reference-mcp install
```

The backend is distributed through Git installation from this fork and runs as
a local stdio process. Its code and onboarding guide are in
[`integrations/mcp/`](integrations/mcp/).

The default terminal binary is `~/.local/bin/ui-reference-mcp` (the prefix may differ via `UI_REFERENCE_INSTALL_PREFIX`; with `<prefix>/bin` on `PATH`, the bare `ui-reference-mcp` name also works).

## Publication status

Upstream Uizze registry, marketplace, and directory entries are not listings
for this fork. The fork does not publish the backend to npm or another package
registry, and it does not claim hosted manifests or registry listings. The Git
install command above fetches the source from this repository; it is not an
npm package publication.

For license and redistribution details, see [the license map](LICENSING.md).
