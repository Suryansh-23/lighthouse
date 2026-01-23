# AGENTS.md

Purpose: onboarding notes and working rules for agents in this repo.

## Project context
- Lighthouse is a VS Code extension for EVM address intelligence.
- Key UX surfaces: hover, CodeLens, optional inspector webview, tree view address book.
- Core capabilities: multi-chain resolution, contract/token detection, explorer links, local cache.
- Performance goals: cache-first UI, low latency, bounded network concurrency.

## Key docs
- `SPEC.md` is the authoritative product + architecture spec.
- `README.md` is currently minimal; rely on `SPEC.md` for context.

## Repository layout (current state)
- Monorepo scaffold is in place with pnpm workspaces.
- Packages:
  - `packages/extension` (VS Code extension)
  - `packages/shared` (types/schemas)
  - `packages/webview` (inspector UI build output placeholder)
- Root tooling: `tsconfig.base.json`, ESLint, Prettier, GitHub Actions CI.
- Extension structure: `src/core` (settings/extraction), `src/data` (cache/rpc), `src/domain` (resolver), `src/ui` (hover/commands).

## Commands (build/lint/test)
- Install: `pnpm install`
- Build all packages: `pnpm build`
- Lint all packages: `pnpm lint`
- Test all packages: `pnpm test`
- Format: `pnpm format`
- Format check: `pnpm format:check`
- Single extension test (mocha):
  - `pnpm --filter @lighthouse/extension test -- --grep "<test name>"`
- If a different runner is introduced (vitest/jest), update this section.

## Code style guidelines
### Language and formatting
- Use TypeScript for all extension code.
- Prefer ES module syntax (`import ... from ...`).
- Keep formatting consistent with the repo formatter once configured.
- Use 2-space indentation unless the formatter dictates otherwise.
- Keep lines readable; wrap long markdown or UI strings for clarity.

### Imports and modules
- Order imports: built-ins, external deps, internal modules, then relative paths.
- Group imports with a blank line between groups.
- Avoid deep relative paths; prefer module-level exports when available.
- Keep VS Code APIs isolated in the UI layer where possible.

### Types and interfaces
- Use explicit types for public APIs and exported functions.
- Model data per `SPEC.md` interfaces (AddressResolution, ChainAddressInfo, etc.).
- Use `type` for unions and aliases, `interface` for object shapes.
- Favor `readonly` and immutable patterns for shared state.
- Normalize addresses via `viem.getAddress` before storage or comparison.

### Naming conventions
- Files: `kebab-case` or `camelCase` following existing repo conventions.
- Functions: verbs + nouns (`resolveAddress`, `extractAddressAtPosition`).
- Types: `PascalCase` (`AddressResolution`, `RpcPool`).
- Constants: `UPPER_SNAKE_CASE` for globals, `camelCase` for local consts.
- Commands: `lighthouse.<verb><Noun>` (e.g., `lighthouse.openExplorer`).

### Error handling
- Never throw from UI surfaces (hover, CodeLens, decorations).
- Use `Result`-like patterns or return partial data when possible.
- Treat all RPC/explorer failures as recoverable; log and cache failures.
- Respect rate limits; backoff on 429 and transient network errors.
- Use `CancellationToken` to stop work on cursor/hover change.

### Async and concurrency
- All network calls are async; never block the UI thread.
- Use bounded queues for multi-chain resolution (see spec scheduler).
- CodeLens must be cache-only; never trigger network calls there.
- Avoid parallel storms; respect `maxQps` and concurrency settings.

### Caching and persistence
- Use workspace storage (`context.storageUri`) for cache + address book.
- Use global storage for shared defaults (`context.globalStorageUri`).
- Store API keys only in `context.secrets` (never settings.json).
- Cache explorer data long-term; cache price data short-term.

### UI/UX behavior
- Hover: render immediately with cached data, then resolve in background.
- CodeLens: show cached summary or `…`/`resolving` when missing.
- Inspector: lazy-load heavy data (ABI, token balances) on open.
- Decorations: keep subtle; default off to avoid visual noise.

### Security and trust
- Respect workspace trust; disable background indexing if untrusted.
- Markdown hovers must use `isTrusted` with explicit command allowlist.
- Webview must enforce CSP and limit `localResourceRoots`.
- Treat all webview messages as untrusted input.

## Architecture conventions (from SPEC.md)
- UI layer: hover/CodeLens/decorations/tree/webview only.
- Domain layer: resolution, indexing, enrichment pipeline, scheduler.
- Data layer: RPC pools, explorer adapters, DefiLlama client, cache store.
- Shared: types, schemas, logging, telemetry (default off).

## Extension-specific patterns
- Activation events should be conservative (no `*`).
- Dispose registrations via `context.subscriptions`.
- Keep provider constructors lightweight; work happens on-demand.
- Avoid native node modules early (packaging burden).

## Indexing and extraction rules
- Regex for address detection: `\b0x[a-fA-F0-9]{40}\b`.
- Trim punctuation boundaries, then validate via `viem.getAddress`.
- Two-tier indexing: on-demand (open docs) + background scan.
- Skip huge files and respect `files.maxMemoryForLargeFilesMB`.

## Testing guidance
- Extension tests live in `packages/extension/src/test` and run via `@vscode/test-electron`.
- Add tests alongside features; prefer unit tests for core logic.
- Keep tests deterministic; mock RPC/explorer/DefiLlama calls.

## Phase status
- Phase 0 complete: pnpm workspace + extension/shared/webview scaffolds.
- Phase 1 in progress: address extraction, cache store, RPC resolver, hover provider, and commands are implemented.

## Linting and formatting
- Follow ESLint/Prettier once added; do not hand-format against them.
- Prefer explicit typing over implicit `any`.
- Avoid unused imports or variables; keep files warning-free.

## Cursor/Copilot rules
- No Cursor or Copilot instructions found in this repo.
- If rules are added later (e.g., `.cursor/rules/`), update this file.

## When in doubt
- Re-read `SPEC.md` for UX/performance expectations.
- Keep networking optional, cached, and failure-tolerant.
- Favor user experience and speed over deep data fetching.
