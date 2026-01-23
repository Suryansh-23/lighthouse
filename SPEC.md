# Lighthouse — VS Code Extension Spec
Version: 0.2 (expanded)
Last updated: 2026-01-23

**One-liner:** Lighthouse turns EVM addresses inside your code into *first-class IDE objects* (hover + CodeLens + inspector) with multi-chain resolution, contract/token detection, explorer links, and a workspace address-book backed by a local cache.

---

## 0) Context and problem statement

As a DeFi backend engineer, you regularly encounter EVM addresses in:
- smart-contract interactions (routers, pools, vaults, oracles, tokens)
- protocol integration configs (chainId → contract map)
- tx debugging (EOA senders, contract addresses, init code, factory deploys)
- logs and data pipelines (event topics, address fields)
- audits and incident response (quickly classify unknown addresses)

**Pain today:** the address is “just text.” You context-switch to explorers/RPC scripts to answer:
- *Which chain is this on? Is it a contract? Which standard? Verified?*
- *Is this token USDC or a random proxy? Is it a pool?*
- *Is it safe / known? How do I bookmark and share it with my repo?*

**Goal:** reduce context switching and make address intelligence immediate, consistent, and cacheable inside VS Code.

---

## 1) Goals, non-goals, success metrics

### 1.1 Goals
1. **Instant address intelligence** in-editor via:
   - hover card (fast + actionable)
   - CodeLens line preview (like the screenshot style)
   - optional inspector webview (deep drilldown)
2. **Multi-chain resolution** with user-configurable chain set (extension + workspace).
3. **Low-friction navigation**: open explorer (default Routescan), copy, “add to address book,” open inspector.
4. **Local-first caching**: once resolved, subsequent views are instant; workspace-scoped cache.
5. **Extensible enrichments**: plug-in style enrichers (ERC detectors, explorers, DefiLlama, protocol labelers).

### 1.2 Non-goals (v0.x)
- full onchain analytics/indexing (historical logs scanning) beyond basic “last N tx” / minimal event queries
- wallet/key management
- performing transactions
- cross-editor compatibility (unless we later split out an LSP)

### 1.3 Success metrics
- P50 hover render time after cache warm: **< 30ms**
- P95 cold resolve for an address on one chain: **< 1s** (depends on RPC)
- Background indexing of a medium repo (<5k files): **< 2 min** (throttled)
- “Explorer open” is always one click from hover/CodeLens/inspector
- Cache hit-rate increases over time; user feels “everything is instant after a day”

---

## 2) UX surfaces (what the user sees)

Lighthouse exposes address intelligence through multiple UI surfaces. These are not redundant: each has a distinct role.

### 2.1 Hover Card (primary)
Triggered by mouse hover over an address.

**Default hover content (fast):**
- checksummed address + chain name + chainId
- entity type: `EOA` vs `Contract`
- if contract: detected class (ERC20/ERC721/ERC1155/ERC4626/Proxy/Unknown)
- label/name/symbol (if any)
- quick actions: **Copy**, **Open Explorer**, **Open Inspector**, **Add to Address Book**

**Extended hover content (lazy / optional):**
- native balance (if EOA)
- token decimals & totalSupply (if ERC20)
- implementation address (if proxy, if discovered)
- “verified on explorer” (if available)
- DefiLlama price + protocol snippet (if available)

Hover should never block the UI: render immediately with cached/partial info and progressively update.

### 2.2 CodeLens (screenshot-style inline preview)
A CodeLens line appears above detected addresses, e.g.:

`Ethereum (1): Contract · ERC20 (USDC) | Open | Copy | Inspect | Add`

- Designed for “scanability” in config files (address maps).
- Clickable actions are commands.
- CodeLens must be cheap: it should not trigger network calls. It should use cache and show `…`/`resolving` if unknown.

### 2.3 Decorations (optional but useful)
Subtle styling of addresses:
- underline or border
- different decoration for contract vs EOA (after known)
- “unresolved” styling (dim) vs “resolved” (normal)

Avoid visual noise. Default off or subtle.

### 2.4 Address Book (Tree View / Side Panel)
A workspace view listing:
- **Indexed addresses**: all addresses found in the repo (by chain when known)
- **Pinned addresses**: user-added/pinned entries with labels and notes

Each node has actions:
- open explorer
- copy
- open inspector
- reveal occurrences (jump to files/positions)
- edit label / notes
- remove from pinned

### 2.5 Inspector Webview (deep dive)
A dedicated panel for one address with tabs:
- **Overview** (type, labels, standard, verification status)
- **Chains** (resolution results per chain scanned)
- **Contract** (bytecode hash, proxy info, ABI status)
- **Token** (ERC data + balances)
- **Links** (Routescan/Blockscout/Etherscan, DefiLlama)
- **Occurrences** (where this address appears in the repo)
- **Notes** (workspace-local annotations)

Webview should not be required for core workflows; it’s “power user mode.”

### 2.6 Commands (Command Palette)
Examples:
- `Lighthouse: Inspect Address…`
- `Lighthouse: Add Address…`
- `Lighthouse: Refresh Address Cache`
- `Lighthouse: Re-index Workspace Addresses`
- `Lighthouse: Configure Chains…` (wizard-ish)

---

## 3) Data sources and enrichments

Lighthouse uses multiple data sources. The core principle: **onchain RPC is the ground truth**, explorers add metadata, DefiLlama adds price/protocol context.

### 3.1 RPC (primary truth)
Minimum RPC calls for “exists + type”:
- `eth_getCode` → contract vs EOA (code length > 0)
- `eth_getBalance` → EOA/native balance (optional)
- `eth_chainId` (for sanity)
Optional:
- `eth_call` for ERC introspection (`name/symbol/decimals`, `supportsInterface`, etc.)

#### RPC provider model
- Built-in chain configs for popular chains.
- Extendable by user via extension settings and/or workspace settings.
- Support multiple RPC URLs per chain with **round-robin + health scoring** + exponential cooldown.

**Source of default RPC list:** ChainList `rpcs.json` (user requested). Use it to pre-populate, but do not depend on it at runtime (ship curated defaults + allow import).  

### 3.2 Explorer APIs (metadata)
Supported explorer families:
- **Etherscan-compatible** (Etherscan + many clones)
- **Blockscout** (often “Etherscan-like” but also has its own endpoints)
- **Routescan** (preferred for UI link unification)

Use explorer APIs for:
- contract verification status
- contract name
- ABI (if verified)
- token metadata (in some explorers)
- labels/tags (if available)

**Important:** explorers have rate limits. Use them opportunistically, cache results aggressively, and always tolerate failures.

### 3.3 DefiLlama API (price + protocol context)
Use cases (common and low-friction):
1. **Token price for `chain:address`** (when ERC20 detected)
2. **Protocol metadata** for a known protocol slug (future: map addresses → protocol)
3. **TVL / chain TVL / stablecoins / yields** for general context and “knownness”

DefiLlama exposes stable public endpoints and a Pro API. Prefer public endpoints first; allow user to plug Pro API key later.

---

## 4) Architecture overview

### 4.1 High-level components
```
VS Code Extension Host
 ├─ UI Layer
 │   ├─ HoverProvider
 │   ├─ CodeLensProvider
 │   ├─ Decorations
 │   ├─ TreeView (Address Book)
 │   └─ Webview (Inspector)
 ├─ Domain Layer
 │   ├─ AddressResolver (multi-chain)
 │   ├─ Enrichment Pipeline (plugins)
 │   ├─ Occurrence Indexer (workspace scan)
 │   └─ RateLimit + Scheduler
 ├─ Data Layer
 │   ├─ RpcPool (per chain)
 │   ├─ ExplorerAdapters (Routescan/Etherscan/Blockscout)
 │   ├─ DefiLlamaClient
 │   └─ CacheStore (workspace/global/secrets)
 └─ Shared
     ├─ Types + Schemas
     ├─ Logging/Tracing
     └─ Telemetry (optional, default off)
```

### 4.2 Extension Host vs LSP (answering your “division” question)
**Default v0.x:** everything runs in the extension host. It is simpler, faster to ship, and avoids LSP complexity.

**When to introduce LSP (Phase 4+):**
- if you want language-agnostic parsing at scale (many file types, large repos)
- if you want diagnostics/code-actions tightly integrated with editor semantics
- if you want portability to other editors

A pragmatic split:
- **Extension host**: UI surfaces, caching, RPC/explorer networking, settings, webview.
- **LSP**: address occurrence indexing + diagnostics (checksum issues, invalid length), optional semantic features.

This mirrors VS Code’s guidance that rich language functionality can be separated (e.g., “language feature” extensions).  

---

## 5) Core data model (TypeScript interfaces)

### 5.1 Identifiers
```ts
export type Address = `0x${string}`;     // always checksum-normalized via viem/getAddress
export type ChainId = number;
export type RpcUrl = string;
export type IsoDate = string;
```

### 5.2 Resolution result
```ts
export interface AddressResolution {
  address: Address;
  scannedAt: IsoDate;

  // chain scanning strategy
  scan: {
    mode: "workspaceChains" | "userChains" | "singleChain";
    chainsAttempted: ChainId[];
    chainsSucceeded: ChainId[];
    chainsFailed: { chainId: ChainId; reason: string }[];
  };

  // per-chain results
  perChain: Record<ChainId, ChainAddressInfo>;
}

export interface ChainAddressInfo {
  chainId: ChainId;
  chainName: string;

  kind: "EOA" | "Contract" | "Unknown";
  exists: boolean;         // contract exists or EOA "exists" (always true if syntactically valid)
  isContract: boolean;     // derived from getCode length

  // balances
  nativeBalanceWei?: string;
  nonce?: number;

  // contract information
  contract?: {
    bytecodeHash?: string;
    deployment?: {
      // optional later if we add traces
      creator?: Address;
      txHash?: string;
      blockNumber?: number;
    };

    // classification
    classification?: ContractClassification;

    // proxy signals
    proxy?: ProxyInfo;

    // metadata from explorers / ABIs
    metadata?: ContractMetadata;
  };

  // token information (if ERC20/721/1155/4626)
  token?: TokenInfo;

  // enriched labels
  labels?: LabelInfo[];
}
```

### 5.3 Contract classification + token info
```ts
export type ContractClassification =
  | { type: "ERC20"; confidence: number }
  | { type: "ERC721"; confidence: number }
  | { type: "ERC1155"; confidence: number }
  | { type: "ERC4626"; confidence: number }
  | { type: "Proxy"; confidence: number; proxyType?: "EIP1967" | "Transparent" | "UUPS" | "Beacon" | "Unknown" }
  | { type: "Multisig"; confidence: number; family?: "Safe" | "Other" }
  | { type: "Pool"; confidence: number; family?: "UniV2" | "UniV3" | "Curve" | "Balancer" | "Other" }
  | { type: "Unknown"; confidence: number };

export interface TokenInfo {
  standard: "ERC20" | "ERC721" | "ERC1155" | "ERC4626";
  name?: string;
  symbol?: string;
  decimals?: number;        // ERC20
  totalSupply?: string;     // ERC20
  asset?: Address;          // ERC4626 underlying
  totalAssets?: string;     // ERC4626
  price?: {
    usd?: number;
    source: "defillama" | "explorer" | "manual";
    fetchedAt: IsoDate;
  };
}
```

### 5.4 Explorer + labels
```ts
export interface ContractMetadata {
  verified?: boolean;
  contractName?: string;
  abi?: any;                // JSON ABI if available (store separately; large)
  sourceUrl?: string;       // explorer link to code
}

export interface LabelInfo {
  label: string;            // e.g. "UniswapV3Pool", "USDC"
  source: "workspace" | "explorer" | "defillama" | "heuristic";
  confidence?: number;
  url?: string;
}
```

### 5.5 Address book entry
```ts
export interface AddressBookEntry {
  address: Address;
  chains?: ChainId[];           // optional pinned chain(s)
  label?: string;
  notes?: string;

  createdAt: IsoDate;
  updatedAt: IsoDate;

  pinned: boolean;              // user-added/pinned
  occurrences?: OccurrenceRef[]; // populated by indexer
}

export interface OccurrenceRef {
  uri: string;                  // document.uri.toString()
  range: { start: { line: number; char: number }, end: { line: number; char: number } };
}
```

---

## 6) Settings, configuration, and storage

### 6.1 Settings layers
Lighthouse uses:
- **User settings** (global)
- **Workspace settings** (`.vscode/settings.json`)

This matches VS Code’s standard settings model.

### 6.2 Key settings (proposed)
```jsonc
{
  "lighthouse.enabled": true,

  // detection scope (start with popular code files)
  "lighthouse.detection.fileGlobs": [
    "**/*.{ts,tsx,js,jsx,sol,rs,go,py,yml,yaml,json,toml,md}"
  ],

  // UX toggles
  "lighthouse.ui.hover.enabled": true,
  "lighthouse.ui.codelens.enabled": true,
  "lighthouse.ui.decorations.enabled": false,
  "lighthouse.ui.webviewInspector.enabled": true,

  // chain scanning
  "lighthouse.chains.mode": "workspaceLimited", // workspaceLimited | userAll | singleChain
  "lighthouse.chains.workspaceAllowlist": [1, 10, 137, 42161, 8453], // default example
  "lighthouse.chains.userChains": [], // user-defined full objects; see below

  // RPC pool behavior
  "lighthouse.rpc.roundRobin": true,
  "lighthouse.rpc.maxConcurrencyPerChain": 4,
  "lighthouse.rpc.cooldownBaseMs": 1000,
  "lighthouse.rpc.maxRetriesBeforeDisable": 10,

  // explorer preference
  "lighthouse.explorer.default": "routescan",   // routescan | blockscout | etherscan
  "lighthouse.explorer.openInExternalBrowser": true,

  // caching
  "lighthouse.cache.ttlSeconds": 86400,
  "lighthouse.cache.maxEntries": 20000,

  // rate limit framework (global budgets)
  "lighthouse.net.maxQps": 8,
  "lighthouse.net.maxConcurrentRequests": 16,

  // security
  "lighthouse.security.respectWorkspaceTrust": true
}
```

### 6.3 User-defined chain config schema
```ts
export interface UserChainConfig {
  chainId: number;
  name: string;
  nativeSymbol: string;

  rpcs: RpcUrl[];          // ordered; can include private endpoints
  explorer?: {
    kind: "routescan" | "etherscan" | "blockscout";
    baseUrl: string;       // UI base URL
    apiBaseUrl?: string;   // API base URL (optional)
  };

  defillamaChainKey?: string; // e.g. "ethereum", "polygon", "arbitrum"
}
```

### 6.4 Storage and persistence
Use the official VS Code storage surfaces:
- `context.storageUri` (workspace-specific) for caches
- `context.globalStorageUri` (global) for shared defaults
- `context.secrets` (SecretStorage) for API keys

Store:
- **Workspace cache** (address resolution results, occurrence index)
- **Address book** (pinned + indexed list)
- **RPC health state** (per workspace + global default)
- **Secrets**: explorer API keys, DefiLlama Pro key if used

---

## 7) Address detection and indexing

### 7.1 Fast extraction (regex + validation)
Regex:
- `\b0x[a-fA-F0-9]{40}\b`
- allow punctuation boundaries (`,`, `)`, `]`, `"` etc.) by trimming non-hex chars
Validation:
- convert to checksum using `viem.getAddress()`; if it throws, ignore
- optionally report a diagnostic for invalid checksums later (Phase 4)

### 7.2 File scope (your choice)
Start with common code/config files only (popular list), as agreed.

### 7.3 Indexing strategy
Two-tier:
1. **On-demand**: resolve addresses in the current open document (high priority)
2. **Background**: scan workspace for occurrences and prefill cache (low priority)

Indexing triggers:
- on activation (if workspace trusted + user enabled)
- on file open/save
- manual command: `Re-index Workspace`

Throttle scanning:
- respect `files.maxMemoryForLargeFilesMB`
- skip huge files > configurable limit
- schedule using a low-priority queue

### 7.4 Occurrence store
Maintain:
- `address → list<OccurrenceRef>`
- `uri → list<addresses>` (for incremental updates)

---

## 8) Resolution pipeline (multi-chain + enrichments)

### 8.1 Multi-chain scanning
Given address `A` and chain set `{C1..Cn}`, scan in parallel but bounded by global concurrency.

**Rule:** Do not “spray” all chains by default. Use workspace allowlist to reduce latency.

### 8.2 Minimal per-chain resolution (Stage 1)
- `getCode(A)`
- classify as EOA vs Contract
- if EOA: optional `getBalance(A)` + `getTransactionCount(A)`
- compute bytecode hash (keccak256(code)) if contract

### 8.3 Standard detection (Stage 2)
For contract:
- ERC165 supportsInterface checks for 721/1155
- best-effort `eth_call` for ERC20 methods
- ERC4626 detection by probing `asset()` and `totalAssets()` (safe-call)

**Safe-call pattern:**
- call with low `gas` (if provider supports specifying)
- catch revert and mark “unknown”
- never crash hover due to revert

### 8.4 Explorer enrichment (Stage 3)
If explorer API key available (or free endpoint):
- fetch verification status, contract name, ABI (optional)
- cache ABI separately and lazily (only fetch if inspector opens)

### 8.5 DefiLlama enrichment (Stage 4)
If ERC20 and `defillamaChainKey` known:
- fetch price for `defillamaChainKey:address`
- attach `token.price.usd`

### 8.6 Workspace annotations (Stage 5)
Apply pinned labels/notes and repository-specific tags.

---

## 9) Networking, rate limiting, and reliability

### 9.1 Global constraints
- never block UI thread
- never exceed configured `maxQps` / concurrency
- degrade gracefully offline

### 9.2 RPC pool strategy (your choice)
- multiple RPCs per chain
- **round-robin**
- exponential cooldown on failures
- disable an RPC temporarily after N failures

**Health scoring state:**
```ts
interface RpcHealth {
  url: string;
  failures: number;
  lastFailureAt?: number;
  cooldownUntil?: number;
  ewmaLatencyMs?: number;
  disabled?: boolean;
}
```

### 9.3 Explorer API usage and rate limits
- prefer Routescan for UI navigation (no API key needed for UI)
- use explorer APIs only when:
  - inspector opened, OR
  - hover is expanded and cached is missing
- cache explorer results with long TTL (e.g., 7 days)

### 9.4 Retry policy
- network errors: retry with jitter up to `maxRetries`
- rate-limited (HTTP 429): backoff exponentially and respect `Retry-After` if provided

### 9.5 Cancellation
All resolve jobs should accept `CancellationToken` so hovers don’t keep running after cursor moves.

---

## 10) Plugin-style enrichments (extensibility)

### 10.1 Enricher interface
```ts
export interface Enricher {
  id: string;
  priority: number; // lower runs first
  supports(ctx: EnrichmentContext): boolean;
  enrich(ctx: EnrichmentContext): Promise<void>;
}

export interface EnrichmentContext {
  address: Address;
  chainId: ChainId;
  info: ChainAddressInfo; // mutable enrichment target
  rpc: RpcClient;
  cache: CacheStore;
  logger: Logger;
  cancel: vscode.CancellationToken;
}
```

### 10.2 Built-in enrichers
- `EoaBasicsEnricher` (balance/nonce)
- `ContractBasicsEnricher` (bytecode hash, proxy signals)
- `ErcDetectorEnricher` (ERC20/721/1155/4626)
- `ExplorerMetadataEnricher` (verification/name/abi status)
- `DefiLlamaPriceEnricher` (USD price for ERC20)

Future enrichers:
- `SafeMultisigEnricher`
- `UniswapPoolEnricher` (factory pattern detection)
- `ApprovalScannerEnricher` (optional, heavy)

---

## 11) VS Code implementation details

This section is “agent-ready”: includes patterns, pitfalls, and concrete code skeletons.

### 11.1 Activation events
Use conservative activation:
- `onStartupFinished`
- `onLanguage:solidity`, `onLanguage:typescript`, etc.
- `onCommand:lighthouse.inspectAddress`
Avoid `*` activation to reduce overhead.

### 11.2 HoverProvider (skeleton)
```ts
import * as vscode from "vscode";
import { extractAddressAtPosition } from "./core/extract";
import { resolveAddress } from "./domain/resolve";

export function registerHover(context: vscode.ExtensionContext) {
  const selector: vscode.DocumentSelector = [{ scheme: "file" }, { scheme: "vscode-remote" }];

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, {
      provideHover: async (doc, pos, token) => {
        const hit = extractAddressAtPosition(doc, pos);
        if (!hit) return;

        // render immediately (cached/partial)
        const md = new vscode.MarkdownString(undefined, true);
        md.supportThemeIcons = true;

        // IMPORTANT: only trust your own commands (avoid command injection)
        md.isTrusted = { enabledCommands: ["lighthouse.openExplorer", "lighthouse.copyAddress", "lighthouse.openInspector", "lighthouse.addToAddressBook"] };

        md.appendMarkdown(`**Lighthouse**\n\n`);
        md.appendMarkdown(`Resolving \`${hit.address}\`…\n`);

        // kick async resolution; return partial hover, then update via cache + next hover
        resolveAddress(hit.address, { token, docUri: doc.uri }).catch(() => {});
        return new vscode.Hover(md, hit.range);
      }
    })
  );
}
```

**Note:** hovers cannot be “live-updated” in place reliably; design the hover to:
- render cached data immediately
- trigger background resolution
- next hover shows updated content

### 11.3 CodeLensProvider (skeleton)
```ts
export function registerCodeLens(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, {
      provideCodeLenses: async (doc, token) => {
        // 1) extract addresses cheaply from document text (or use per-doc index)
        // 2) for each, read cache and produce CodeLens commands
        // 3) never do network calls here
        return [];
      }
    })
  );
}
```

### 11.4 TreeView Address Book
- Use `vscode.TreeDataProvider`
- Keep state in workspace storage + in-memory map
- Provide context menu actions via `contributes.menus`

### 11.5 Webview Inspector (security + structure)
Follow VS Code webview security guidance:
- restrict `localResourceRoots`
- use CSP
- avoid remote scripts
- message passing via `postMessage`

**Panel setup (sketch):**
```ts
const panel = vscode.window.createWebviewPanel(
  "lighthouseInspector",
  `Lighthouse: ${address}`,
  vscode.ViewColumn.Beside,
  {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")]
  }
);
panel.webview.html = renderInspectorHtml(panel.webview, context.extensionUri);
panel.webview.onDidReceiveMessage(async (msg) => { /* ... */ });
```

### 11.6 Secrets
Use `context.secrets` for API keys.
Never store keys in settings.json.

### 11.7 Workspace Trust
When `lighthouse.security.respectWorkspaceTrust` is true:
- disable background indexing in untrusted workspaces
- allow manual resolve only (explicit user action)

Declare support in `package.json` via `capabilities.untrustedWorkspaces`:
- recommended: `'limited'` (basic features OK, networking/indexing gated)

---

## 12) DefiLlama integration details

### 12.1 Common endpoints to implement (v0.x)
Implement a small DefiLlama client with:
- `GET /protocols` (list protocols)
- `GET /protocol/{slug}` (protocol info)
- `GET /coins/prices/current/{coins}` (price for one/many coins)
- optional: `GET /chains` (chain metadata), `GET /yields/pools`

### 12.2 Mapping `chain + address` to DefiLlama coin key
Use format like:
- `ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- `arbitrum:0x...`
The chain key should come from chain config (`defillamaChainKey`).

### 12.3 Caching
- price TTL: short (e.g., 60–300 seconds)
- protocol metadata TTL: long (hours/days)

---

## 13) Build plan (phases with feature decomposition)

### Phase 0 — Repo scaffold (1 day)
- monorepo layout (or single package) with:
  - `packages/extension`
  - `packages/shared` (types/schemas)
  - optional `packages/webview` (build output in `extension/media`)
- TypeScript, eslint, prettier
- test harness via `@vscode/test-electron`
- CI: lint + unit tests + package build

Deliverables:
- empty extension activates via command
- settings schema wired

### Phase 1 — MVP: hover + explorer + copy (2–4 days)
Features:
- address extraction in supported files
- hover shows:
  - address (checksummed)
  - quick actions: copy/open explorer/add to address book/inspect
- cache store (workspace)
- RPC: single-chain or limited chains; minimal resolution (getCode)
- basic chain config system

Deliverables:
- stable hover and commands
- “Open explorer” defaults to Routescan

### Phase 2 — CodeLens + address book + background indexing (4–7 days)
Features:
- CodeLens above addresses (cache-driven)
- TreeView Address Book:
  - indexed addresses + pinned addresses
  - reveal occurrences
- background indexing (throttled)
- RPC pool rotation + cooldown
- workspace chain allowlist for speed

Deliverables:
- screenshot-style UX achieved
- cold-start repo scan populates address book

### Phase 3 — Contract/token detection + enrichments (5–10 days)
Features:
- ERC detection: 20/721/1155/4626
- proxy heuristics (EIP-1967 slots, optional)
- DefiLlama price for ERC20
- explorer metadata (verification + contract name)
- enrichment plugin interface + built-ins

Deliverables:
- hover shows “ERC20 USDC · $1.00” style info where possible

### Phase 4 — Inspector webview (5–10 days)
Features:
- inspector panel with tabs (overview/chains/contract/token/occurrences/notes)
- lazy ABI fetching when inspector opens
- better loading states + progress UI
- “copy as snippet” actions (e.g., `CHAIN_ID_TO_ADDR` map entry)

Deliverables:
- power-user panel usable for deep inspection

### Phase 5 — Diagnostics + code actions + optional LSP (future)
Features:
- diagnostics for invalid address formats/checksum
- quick fixes: checksum, normalize
- optional LSP split for scaling / portability

---

## 14) Engineering best practices and “gotchas” for VS Code extensions

### 14.1 Performance
- Never do network calls in CodeLens provider.
- Debounce document change events.
- Use `CancellationToken` aggressively: hover resolves should cancel when cursor moves.

### 14.2 Disposal
Anything you register should be disposed via `context.subscriptions`.

### 14.3 Webview security
- use CSP
- avoid `isTrusted = true` globally in MarkdownString
- restrict local resources via `localResourceRoots`
- treat all messages from webview as untrusted input

### 14.4 Secrets
Use SecretStorage.

### 14.5 Workspace trust / restricted mode
Declare limited support; gate indexing and external calls.

### 14.6 Native Node modules
Avoid native deps in early versions (packaging pain). Prefer pure JS libs.

### 14.7 Rate limit discipline
Explorer APIs are the first to throttle. Cache and backoff.

---

## 15) Reference implementations (repos to study)

These are intentionally “agent friendly” references:
- VS Code official samples: https://github.com/microsoft/vscode-extension-samples
  - hover, codelens, tree view, webview patterns
- LSP reference: https://github.com/microsoft/vscode-languageserver-node
- Similar domain extensions:
  - ETHover: https://github.com/crystal-codes/ETHover
  - defi-ls: https://github.com/zeroqb/defi-ls

---

## 16) Open design decisions (remaining)
1. **Default chain allowlist** (ship: mainnet + popular L2s?).
2. **Cache format**: JSON shards vs LevelDB vs SQLite (start with JSON shards).
3. **Proxy detection depth**: EIP-1967 only vs broader heuristics.
4. **Explorer API key UX**: command “Set Etherscan Key” vs settings UI.

---

## 17) Appendix: pseudocode

### 17.1 Multi-chain resolve scheduler
```ts
async function resolveAddressMultiChain(address, chains, cancel) {
  const results = {};
  const tasks = chains.map(chainId => queue.enqueue(async () => {
    const rpc = rpcPool.get(chainId);
    const code = await rpc.getCode(address, cancel);
    const info = { chainId, isContract: code !== "0x" };
    results[chainId] = info;

    if (info.isContract) await enrichContract(address, chainId, info, cancel);
    else await enrichEoa(address, chainId, info, cancel);
  }));

  await Promise.allSettled(tasks);
  cache.write(address, results);
  return results;
}
```

### 17.2 RPC pool pick + cooldown
```ts
function pickRpc(chainId) {
  const pool = state[chainId].rpcs.filter(r => !r.disabled && now() > (r.cooldownUntil ?? 0));
  return roundRobin(pool);
}

async function withRpc(chainId, fn) {
  const rpc = pickRpc(chainId);
  try {
    const t0 = now();
    const res = await fn(rpc);
    rpc.ewmaLatencyMs = ewma(rpc.ewmaLatencyMs, now()-t0);
    return res;
  } catch (e) {
    rpc.failures++;
    rpc.cooldownUntil = now() + cooldownMs(rpc.failures);
    if (rpc.failures >= MAX_FAIL) rpc.disabled = true;
    throw e;
  }
}
```

---

## 18) Naming note
“Lighthouse” is widely used in web performance tooling and there are already Marketplace listings named Lighthouse in other categories (e.g., Azure Pipelines / themes). Consider publishing as `lighthouse-evm` or `lighthouse-addresses` to avoid discoverability collisions.

