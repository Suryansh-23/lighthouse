# Lighthouse

Lighthouse turns EVM addresses inside your code into first-class IDE objects.
It provides hover cards, CodeLens previews, an inspector webview, and a workspace
address book with cache-backed enrichment.

## Highlights
- Hover cards with cached address intelligence and quick actions
- CodeLens summary line for fast scanning in config files
- Address book tree view with pinned and indexed addresses
- Inspector webview with overview, chains, contract, token, and occurrences
- ERC detection, proxy heuristics, explorer metadata, and DefiLlama pricing
- Workspace-scoped cache and optional background indexing
- Engine package usable outside VS Code for future IDEs/CLI tools

## Repository layout
- `packages/engine`: core resolver, enrichers, RPC client/pool, explorers
- `packages/extension`: VS Code integration and UI surfaces
- `packages/shared`: shared types and schemas
- `packages/webview`: inspector UI placeholder build output
- `SPEC.md`: authoritative product spec and architecture

## Requirements
- Node.js 18+
- pnpm 9+
- VS Code 1.88+
- `code` CLI available in PATH (optional, for install script)

## Quick start
```bash
pnpm install
pnpm build
pnpm lint
pnpm test
```

## Run the extension (development)
Option A: VS Code launch config (recommended)
1. Open this repo in VS Code
2. Run and Debug -> "Run Lighthouse Extension"

Option B: CLI
```bash
pnpm extension:dev
```

The extension host opens a new VS Code window with Lighthouse loaded.

## Package and install a VSIX
```bash
pnpm extension:package
pnpm extension:install
```

The install command uses `code --install-extension` under the hood.

## Commands
- `Lighthouse: Inspect Address...`
- `Lighthouse: Open Explorer`
- `Lighthouse: Copy Address`
- `Lighthouse: Add to Address Book`
- `Lighthouse: Remove from Address Book`
- `Lighthouse: Reveal Address Occurrences`
- `Lighthouse: Re-index Workspace Addresses`
- `Lighthouse: Clear Cache`
- `Lighthouse: Set Explorer API Key`

## Settings
```jsonc
{
  "lighthouse.enabled": true,
  "lighthouse.detection.fileGlobs": ["**/*.{ts,tsx,js,jsx,sol,rs,go,py,yml,yaml,json,toml,md}"],
  "lighthouse.ui.hover.enabled": true,
  "lighthouse.ui.codelens.enabled": true,
  "lighthouse.chains.mode": "workspaceLimited",
  "lighthouse.chains.workspaceAllowlist": [1, 10, 137, 42161, 8453],
  "lighthouse.chains.userChains": [],
  "lighthouse.rpc.roundRobin": true,
  "lighthouse.rpc.cooldownBaseMs": 1000,
  "lighthouse.rpc.maxRetriesBeforeDisable": 10,
  "lighthouse.explorer.default": "routescan",
  "lighthouse.explorer.openInExternalBrowser": true,
  "lighthouse.cache.ttlSeconds": 86400,
  "lighthouse.security.respectWorkspaceTrust": true
}
```

## How to use the features
### Hover card
Hover any `0x...` address in a supported file. The hover shows cached data
immediately and triggers a background resolve if needed.

### CodeLens
Addresses in supported files show a summary line with actions above them.
CodeLens is cache-only and never triggers network calls.

### Address book
Open the "Lighthouse Address Book" view in the Explorer panel. Pinned addresses
appear at the top, indexed addresses appear below. Use context menu actions to
open, copy, inspect, reveal occurrences, or remove pinned entries.

### Inspector
Run `Lighthouse: Inspect Address...` or click Inspect from hover/CodeLens.
The inspector webview provides deep details (overview, chains, contract, token,
occurrences, notes). It reuses cached data and resolves on demand.

### Diagnostics
Invalid addresses are marked with a warning. Non-checksummed addresses show an
info diagnostic with a quick fix to normalize the checksum.

### Explorer metadata
Provide an API key with `Lighthouse: Set Explorer API Key` to enable verified
contract metadata. The key is stored in VS Code secrets.

## Engine usage (non-VS Code)
The engine package hosts core logic (resolver, enrichers, RPC client, chain
config). It is designed for reuse in future IDE integrations or CLI tooling.

## Development notes
- Core logic lives in `packages/engine`; VS Code integration lives in
  `packages/extension`.
- Use `pnpm extension:build` to compile the extension quickly.
- Use `pnpm extension:test` to run the VS Code integration tests.

## Validation plan
Use `docs/local-validation-plan.md` for step-by-step validation and feedback
collection when testing features locally.

## Troubleshooting
- If CI fails due to `pnpm-lock.yaml`, run `pnpm install` and commit the lockfile.
- If commands do not appear, ensure the extension is activated (run the command
  palette entry or reload the extension host window).

## License
MIT. See `LICENSE`.
