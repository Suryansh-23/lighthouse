import * as vscode from "vscode";

import type { ChainId } from "@lighthouse/shared";

import {
  buildExplorerEntityUrl,
  getChainById,
  resolveChains,
  RoutescanClient,
  normalizeAddress,
  type ChainConfig,
  resolveNetworkId,
  DefiLlamaClient,
} from "@lighthouse/engine";
import { getSettings } from "../core/settings";

type SearchEntityType = "address" | "tx" | "block";

interface SearchChain {
  chainId: ChainId;
  name: string;
  apiBaseUrl: string;
}

interface SearchResultItem {
  id: string;
  chainId: ChainId;
  chainName: string;
  kind: string;
  title: string;
  subtitle?: string;
  badge?: string;
  iconUrl?: string;
  entityType: SearchEntityType;
  entityValue: string;
  copyValue?: string;
  score: number;
  baseScore?: number;
  marketCap?: number;
  priority?: number;
  reputation?: string;
  symbol?: string;
  name?: string;
  exchangeRate?: number;
  isVerified?: boolean;
  tokenType?: string;
  source?: "blockscout" | "routescan";
  hasDefiLlamaPrice?: boolean;
  hasLogo?: boolean;
  hasRoutescanMetadata?: boolean;
}

interface SearchResponse {
  items: BlockscoutItem[];
  next_page_params?: Record<string, string | number | null>;
}

type BlockscoutItem = BlockscoutToken | BlockscoutAddress | BlockscoutBlock | BlockscoutTransaction;

interface BlockscoutToken {
  type: "token";
  address_hash: string;
  name: string;
  symbol: string;
  token_type: string;
  exchange_rate?: string | null;
  icon_url?: string | null;
  priority?: number;
  reputation?: string | null;
  circulating_market_cap?: string | null;
  is_smart_contract_verified?: boolean;
  is_verified_via_admin_panel?: boolean;
  total_supply?: string;
}

interface BlockscoutAddress {
  type: "address" | "contract";
  address_hash: string;
  name?: string;
  is_smart_contract_verified?: boolean;
  reputation?: string | null;
  priority?: number;
}

interface BlockscoutBlock {
  type: "block";
  block_hash: string;
  block_number?: number;
  timestamp?: string;
  priority?: number;
}

interface BlockscoutTransaction {
  type: "transaction";
  transaction_hash: string;
  timestamp?: string;
  priority?: number;
}

interface SearchQuickPickItem extends vscode.QuickPickItem {
  data?: SearchResultItem;
  action?: "loadMore" | "empty";
}

const BLOCKSCOUT_APIS: Record<number, string> = {
  1: "https://eth.blockscout.com/api/v2",
  10: "https://optimism.blockscout.com/api/v2",
  42161: "https://arbitrum.blockscout.com/api/v2",
  8453: "https://base.blockscout.com/api/v2",
  100: "https://gnosis.blockscout.com/api/v2",
};

const COPY_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon("copy"),
  tooltip: "Copy",
};

export function registerSearch(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("lighthouse.search", async () => {
      const picker = new SearchQuickPick();
      await picker.open();
    }),
  );
}

class SearchQuickPick {
  private requestId = 0;
  private currentQuery = "";
  private resultsByChain = new Map<ChainId, SearchResultItem[]>();
  private nextPageByChain = new Map<ChainId, Record<string, string | number | null>>();
  private searchChains: SearchChain[] = [];
  private routescanClient: RoutescanClient | undefined;
  private readonly directCache = new Map<string, SearchResultItem>();
  private readonly enhancedTokens = new Set<string>();
  private tokenEnhanceId = 0;
  private abortController: AbortController | undefined;
  private debounceHandle: NodeJS.Timeout | undefined;
  private quickPick: vscode.QuickPick<SearchQuickPickItem> | undefined;
  private defillamaClient = new DefiLlamaClient();

  async open() {
    this.quickPick = vscode.window.createQuickPick<SearchQuickPickItem>();
    this.quickPick.title = "Lighthouse Search";
    this.quickPick.placeholder = "Search addresses, tokens, tx hashes, blocks";
    this.quickPick.matchOnDetail = false;
    this.quickPick.matchOnDescription = false;
    this.quickPick.items = [createEmptyItem("Type to search")];

    this.quickPick.onDidChangeValue((value) => this.queueSearch(value));
    this.quickPick.onDidAccept(() => this.onAccept());
    this.quickPick.onDidTriggerItemButton((event) => this.onItemButton(event));
    this.quickPick.onDidHide(() => this.dispose());

    this.syncChains();
    this.syncRoutescanClient();
    this.quickPick.show();
  }

  private dispose() {
    this.abortController?.abort();
    this.quickPick?.dispose();
    this.quickPick = undefined;
  }

  private queueSearch(value: string) {
    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
    }
    this.debounceHandle = setTimeout(() => {
      void this.startSearch(value);
    }, 300);
  }

  private async startSearch(query: string) {
    this.currentQuery = query.trim();
    this.requestId += 1;
    const token = this.requestId;
    this.resultsByChain.clear();
    this.nextPageByChain.clear();
    this.directCache.clear();
    this.enhancedTokens.clear();
    this.tokenEnhanceId += 1;
    this.abortController?.abort();
    this.abortController = new AbortController();

    if (!this.currentQuery) {
      this.updateItems([createEmptyItem("Type to search")]);
      return;
    }

    this.setLoading(true);
    const blockscoutChains = this.searchChains.filter((chain) => Boolean(chain.apiBaseUrl));
    await Promise.all([
      this.runDirectLookups(token),
      runWithLimit(blockscoutChains, 3, async (chain) => {
        const response = await fetchSearch(
          chain,
          this.currentQuery,
          undefined,
          this.abortController?.signal,
        );
        if (token !== this.requestId) {
          return;
        }
        if (response) {
          let mapped = response.items
            .map((item) => toSearchItem(chain, item, this.currentQuery))
            .filter(isSearchResultItem);
          mapped = await this.enhanceTokenScores(mapped, token);
          this.resultsByChain.set(chain.chainId, sortResults(mapped, this.currentQuery));
          if (response.next_page_params && hasNextParams(response.next_page_params)) {
            this.nextPageByChain.set(chain.chainId, response.next_page_params);
          }
        }
        this.updateItems(this.buildItems());
      }),
    ]);
    this.setLoading(false);
  }

  private async loadMore() {
    if (!this.currentQuery || this.nextPageByChain.size === 0) {
      return;
    }

    this.requestId += 1;
    const token = this.requestId;
    this.setLoading(true);
    const pendingChains = this.searchChains.filter((chain) =>
      this.nextPageByChain.has(chain.chainId),
    );

    await runWithLimit(pendingChains, 2, async (chain) => {
      const params = this.nextPageByChain.get(chain.chainId);
      const response = await fetchSearch(
        chain,
        this.currentQuery,
        params,
        this.abortController?.signal,
      );
      if (token !== this.requestId) {
        return;
      }
      if (response) {
        const existing = this.resultsByChain.get(chain.chainId) ?? [];
        let nextItems = response.items
          .map((item) => toSearchItem(chain, item, this.currentQuery))
          .filter(isSearchResultItem);
        nextItems = await this.enhanceTokenScores(nextItems, token);
        this.resultsByChain.set(
          chain.chainId,
          sortResults([...existing, ...nextItems], this.currentQuery),
        );
        if (response.next_page_params && hasNextParams(response.next_page_params)) {
          this.nextPageByChain.set(chain.chainId, response.next_page_params);
        } else {
          this.nextPageByChain.delete(chain.chainId);
        }
      }
      this.updateItems(this.buildItems());
    });

    this.setLoading(false);
  }

  private onAccept() {
    const selected = this.quickPick?.selectedItems[0];
    if (!selected) {
      return;
    }
    if (selected.action === "loadMore") {
      void this.loadMore();
      return;
    }
    if (!selected.data) {
      return;
    }
    const item = selected.data;
    if (this.quickPick) {
      this.quickPick.hide();
    }
    void this.promptAction(item);
  }

  private async onItemButton(event: vscode.QuickPickItemButtonEvent<SearchQuickPickItem>) {
    if (event.button.tooltip !== "Copy") {
      return;
    }
    const value = event.item.data?.copyValue;
    if (!value) {
      return;
    }
    await vscode.env.clipboard.writeText(value);
    void vscode.window.showInformationMessage("Lighthouse: Copied to clipboard.");
  }

  private async openItem(item: SearchResultItem) {
    const settings = getSettings();
    const chain = getChainById(item.chainId, settings.chains);
    const url = buildExplorerEntityUrl(
      item.entityType,
      item.entityValue,
      chain,
      settings.explorer.default,
    );
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  private async promptAction(item: SearchResultItem) {
    const options: Array<{ label: string; action: "open" | "copy" }> = [
      { label: "Open in Explorer", action: "open" },
    ];
    if (item.copyValue) {
      options.push({ label: "Copy Address/Hash", action: "copy" });
    }

    const choice = await vscode.window.showQuickPick(options, {
      title: "Lighthouse Search",
      placeHolder: item.title,
    });
    if (!choice) {
      return;
    }
    if (choice.action === "open") {
      await this.openItem(item);
      return;
    }
    if (item.copyValue) {
      await vscode.env.clipboard.writeText(item.copyValue);
      void vscode.window.showInformationMessage("Lighthouse: Copied to clipboard.");
    }
  }

  private setLoading(loading: boolean) {
    if (this.quickPick) {
      this.quickPick.busy = loading;
    }
  }

  private updateItems(items: SearchQuickPickItem[]) {
    if (!this.quickPick) {
      return;
    }
    this.quickPick.items = items;
  }

  private buildItems(): SearchQuickPickItem[] {
    const direct = Array.from(this.directCache.values());
    const items = interleaveResults(this.searchChains, this.resultsByChain, 80, direct).map(
      (result) => toQuickPickItem(result),
    );
    if (items.length === 0) {
      return [createEmptyItem("No results")];
    }
    if (this.nextPageByChain.size > 0) {
      items.push({
        label: "Load more results",
        description: "Fetch the next page from all chains",
        action: "loadMore",
        alwaysShow: true,
      });
    }
    return items;
  }

  private syncChains() {
    const settings = getSettings();
    this.searchChains = resolveChains(settings.chains).map((chain) => ({
      chainId: chain.chainId,
      name: chain.name,
      apiBaseUrl: BLOCKSCOUT_APIS[chain.chainId] ?? "",
    }));
  }

  private syncRoutescanClient() {
    const settings = getSettings();
    const apiKey = settings.explorer.apiKeys.routescan || undefined;
    this.routescanClient = new RoutescanClient({ apiKey });
    this.defillamaClient = new DefiLlamaClient();
  }

  private async runDirectLookups(token: number) {
    const query = this.currentQuery;
    if (!query || !this.routescanClient) {
      return;
    }
    const normalizedAddress = normalizeAddress(query);
    if (normalizedAddress) {
      await this.resolveAddressDirect(token, normalizedAddress);
      return;
    }
    if (isLikelyTxHash(query)) {
      await this.resolveTransactionDirect(token, query);
    }
  }

  private async resolveAddressDirect(token: number, address: string) {
    const settings = getSettings();
    const networkIds = getNetworkIds(settings.chains);
    const tasks = networkIds.map(async (networkId) => {
      if (token !== this.requestId) {
        return;
      }
      const result = await this.routescanClient?.listAddresses(
        networkId,
        "all",
        { ids: address, limit: 5 },
        this.abortController?.signal,
      );
      if (!result?.items || token !== this.requestId) {
        return;
      }
      for (const item of result.items) {
        const chainId = toChainId(item.chainId);
        if (!chainId) {
          continue;
        }
        const chainName = getChainById(chainId, settings.chains)?.name ?? `Chain ${chainId}`;
        const mapped = mapRoutescanAddress({ chainId, name: chainName, apiBaseUrl: "" }, address);
        if (!mapped) {
          continue;
        }
        this.directCache.set(mapped.id, mapped);
      }
      this.updateItems(this.buildItems());
    });

    await Promise.all(tasks);
  }

  private async resolveTransactionDirect(token: number, txHash: string) {
    const settings = getSettings();
    const networkIds = getNetworkIds(settings.chains);
    const tasks = networkIds.map(async (networkId) => {
      if (token !== this.requestId) {
        return;
      }
      const result = await this.routescanClient?.getTransactionAll(
        networkId,
        txHash,
        this.abortController?.signal,
      );
      if (!result || token !== this.requestId) {
        return;
      }
      const chainId = toChainId(result.chainId);
      const chainName = chainId
        ? (getChainById(chainId, settings.chains)?.name ?? `Chain ${chainId}`)
        : "Unknown chain";
      const chain = chainId
        ? { chainId, name: chainName, apiBaseUrl: "" }
        : { chainId: 0, name: chainName, apiBaseUrl: "" };
      const item = mapRoutescanTransaction(chain, txHash, result);
      if (!item) {
        return;
      }
      this.directCache.set(item.id, item);
      this.updateItems(this.buildItems());
    });

    await Promise.all(tasks);
  }

  private async enhanceTokenScores(items: SearchResultItem[], token: number) {
    const tokens = items.filter((item) => item.kind === "token");
    if (tokens.length === 0) {
      return items;
    }

    const settings = getSettings();
    const chainMap = new Map(
      resolveChains(settings.chains).map((chain) => [chain.chainId, chain] as const),
    );

    const runId = this.tokenEnhanceId;
    const candidates = tokens
      .filter((item) => !this.enhancedTokens.has(item.id))
      .sort((a, b) => (b.baseScore ?? b.score) - (a.baseScore ?? a.score))
      .slice(0, 8);

    await runWithLimit(candidates, 2, async (item) => {
      if (token !== this.requestId || runId !== this.tokenEnhanceId) {
        return;
      }
      const chain = chainMap.get(item.chainId);
      if (!chain || !chain.defillamaChainKey) {
        return;
      }
      const result = await this.defillamaClient.getPrice(chain.defillamaChainKey, item.entityValue);
      if (!result?.price) {
        return;
      }
      item.hasDefiLlamaPrice = true;
      if (item.exchangeRate === undefined) {
        item.exchangeRate = result.price;
      }
    });

    await runWithLimit(candidates, 2, async (item) => {
      if (token !== this.requestId || runId !== this.tokenEnhanceId) {
        return;
      }
      if (!this.routescanClient) {
        return;
      }
      const chain = chainMap.get(item.chainId);
      if (!chain) {
        return;
      }
      const metadata = await this.routescanClient.getContractMetadata(
        chain,
        item.entityValue as never,
        this.abortController?.signal,
      );
      if (!metadata) {
        return;
      }
      item.hasRoutescanMetadata = true;
      if (metadata.verified) {
        item.isVerified = item.isVerified ?? true;
      }
      if (metadata.contractName && !item.name) {
        item.name = metadata.contractName;
      }
    });

    for (const item of candidates) {
      this.enhancedTokens.add(item.id);
    }

    const updated = items.map((item) => {
      if (item.kind !== "token") {
        return item;
      }
      const base = item.baseScore ?? item.score;
      const boosted = base + tokenSignalBoost(item);
      return { ...item, score: boosted };
    });

    if (token === this.requestId && runId === this.tokenEnhanceId) {
      this.updateItems(this.buildItems());
    }

    return updated;
  }
}

async function fetchSearch(
  chain: SearchChain,
  query: string,
  pageParams?: Record<string, string | number | null>,
  signal?: AbortSignal,
): Promise<SearchResponse | undefined> {
  if (!chain.apiBaseUrl) {
    return undefined;
  }
  const url = new URL(`${chain.apiBaseUrl}/search`);
  url.searchParams.set("q", query);
  if (pageParams) {
    for (const [key, value] of Object.entries(pageParams)) {
      if (value === null || value === undefined) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }

  try {
    const response = await fetch(url.toString(), { signal });
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as SearchResponse;
  } catch {
    return undefined;
  }
}

function hasNextParams(params: Record<string, string | number | null>): boolean {
  return Object.values(params).some(
    (value) => value !== null && value !== undefined && value !== "",
  );
}

function toSearchItem(
  chain: SearchChain,
  item: BlockscoutItem,
  query: string,
): SearchResultItem | undefined {
  const reputation = getReputation(item);
  if (reputation && reputation !== "ok") {
    return undefined;
  }

  if (item.type === "token") {
    const marketCap = parseNumber(item.circulating_market_cap);
    const exchangeRate = parseNumber(item.exchange_rate);
    const title =
      item.symbol && item.name && item.symbol !== item.name
        ? `${item.symbol} - ${item.name}`
        : item.symbol || item.name || "Token";
    const hasLogo = Boolean(item.icon_url);
    const score = scoreItem(
      {
        kind: item.type,
        title: item.name || item.symbol || "",
        symbol: item.symbol,
        name: item.name,
        priority: item.priority,
        marketCap,
        exchangeRate,
        isVerified: item.is_smart_contract_verified,
      },
      query,
    );
    return {
      id: `${chain.chainId}:${item.type}:${item.address_hash}`,
      chainId: chain.chainId,
      chainName: chain.name,
      kind: item.type,
      title,
      subtitle: item.name ? item.name : undefined,
      badge: item.is_smart_contract_verified ? "Verified" : "Token",
      iconUrl: item.icon_url ?? undefined,
      entityType: "address",
      entityValue: item.address_hash,
      copyValue: item.address_hash,
      score,
      baseScore: score,
      marketCap,
      priority: item.priority,
      reputation: item.reputation ?? undefined,
      symbol: item.symbol,
      name: item.name,
      exchangeRate,
      isVerified: item.is_smart_contract_verified,
      tokenType: item.token_type,
      hasLogo,
    };
  }

  if (item.type === "address" || item.type === "contract") {
    const title = item.name ? item.name : shortenHash(item.address_hash);
    const subtitle = item.name ? item.address_hash : "";
    const badge = item.is_smart_contract_verified
      ? "Verified"
      : item.type === "contract"
        ? "Contract"
        : "Address";
    return {
      id: `${chain.chainId}:${item.type}:${item.address_hash}`,
      chainId: chain.chainId,
      chainName: chain.name,
      kind: item.type,
      title,
      subtitle,
      badge,
      entityType: "address",
      entityValue: item.address_hash,
      copyValue: item.address_hash,
      score: scoreItem(
        {
          kind: item.type,
          title,
          name: item.name,
          priority: item.priority,
          isVerified: item.is_smart_contract_verified,
        },
        query,
      ),
      priority: item.priority,
      reputation: item.reputation ?? undefined,
      isVerified: item.is_smart_contract_verified,
    };
  }

  if (item.type === "transaction") {
    return {
      id: `${chain.chainId}:${item.type}:${item.transaction_hash}`,
      chainId: chain.chainId,
      chainName: chain.name,
      kind: item.type,
      title: `Tx ${shortenHash(item.transaction_hash)}`,
      subtitle: item.timestamp ?? "",
      badge: "Transaction",
      entityType: "tx",
      entityValue: item.transaction_hash,
      copyValue: item.transaction_hash,
      score: scoreItem(
        {
          kind: item.type,
          title: item.transaction_hash,
          priority: item.priority,
        },
        query,
      ),
      priority: item.priority,
    };
  }

  if (item.type === "block") {
    const title = item.block_number
      ? `Block #${item.block_number}`
      : `Block ${shortenHash(item.block_hash)}`;
    return {
      id: `${chain.chainId}:${item.type}:${item.block_hash}`,
      chainId: chain.chainId,
      chainName: chain.name,
      kind: item.type,
      title,
      subtitle: item.timestamp ?? "",
      badge: "Block",
      entityType: "block",
      entityValue: item.block_hash || String(item.block_number ?? ""),
      copyValue: item.block_hash || String(item.block_number ?? ""),
      score: scoreItem(
        {
          kind: item.type,
          title: String(item.block_number ?? item.block_hash),
          priority: item.priority,
        },
        query,
      ),
      priority: item.priority,
    };
  }

  return {
    id: `${chain.chainId}:unknown:${Math.random().toString(36).slice(2, 8)}`,
    chainId: chain.chainId,
    chainName: chain.name,
    kind: "unknown",
    title: "Unknown result",
    badge: "Unknown",
    entityType: "address",
    entityValue: "",
    score: 0,
  };
}

function interleaveResults(
  chains: SearchChain[],
  resultsByChain: Map<ChainId, SearchResultItem[]>,
  limit: number,
  direct: SearchResultItem[] = [],
): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();
  for (const item of direct) {
    if (results.length >= limit) {
      break;
    }
    if (seen.has(item.id)) {
      continue;
    }
    results.push(item);
    seen.add(item.id);
  }
  let index = 0;
  while (results.length < limit) {
    let added = false;
    for (const chain of chains) {
      const items = resultsByChain.get(chain.chainId) ?? [];
      if (index < items.length) {
        const item = items[index];
        if (!seen.has(item.id)) {
          results.push(item);
          seen.add(item.id);
        }
        added = true;
        if (results.length >= limit) {
          break;
        }
      }
    }
    if (!added) {
      break;
    }
    index += 1;
  }
  return results;
}

function toQuickPickItem(item: SearchResultItem): SearchQuickPickItem {
  const descriptionParts = [item.chainName];
  if (item.badge) {
    descriptionParts.push(item.badge);
  }
  if (item.kind === "token") {
    if (item.tokenType) {
      descriptionParts.push(item.tokenType);
    }
    const marketCap = formatMarketCap(item.marketCap);
    if (marketCap) {
      descriptionParts.push(marketCap);
    }
  }
  return {
    label: item.title,
    description: descriptionParts.join(" | "),
    detail: buildDetail(item),
    data: item,
    buttons: item.copyValue ? [COPY_BUTTON] : undefined,
    iconPath: item.iconUrl ? vscode.Uri.parse(item.iconUrl) : iconForKind(item.kind),
  };
}

async function runWithLimit<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) {
        return;
      }
      await task(next);
    }
  });

  await Promise.all(workers);
}

function shortenHash(value: string): string {
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function createEmptyItem(label: string): SearchQuickPickItem {
  return { label, action: "empty", alwaysShow: true };
}

function parseNumber(value?: string | number | null): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function isSearchResultItem(item: SearchResultItem | undefined): item is SearchResultItem {
  return Boolean(item);
}

function getReputation(item: BlockscoutItem): string | undefined {
  const reputation = (item as { reputation?: string | null }).reputation;
  return reputation ?? undefined;
}

function sortResults(items: SearchResultItem[], query: string): SearchResultItem[] {
  const normalized = query.toLowerCase();
  return [...items].sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    if (a.kind === "token" && b.kind === "token") {
      const aVerified = a.isVerified ? 1 : 0;
      const bVerified = b.isVerified ? 1 : 0;
      if (aVerified !== bVerified) {
        return bVerified - aVerified;
      }
      const aDefi = a.hasDefiLlamaPrice ? 1 : 0;
      const bDefi = b.hasDefiLlamaPrice ? 1 : 0;
      if (aDefi !== bDefi) {
        return bDefi - aDefi;
      }
      const aMcap = a.marketCap ?? 0;
      const bMcap = b.marketCap ?? 0;
      if (aMcap !== bMcap) {
        return bMcap - aMcap;
      }
      const aLogo = a.hasLogo ? 1 : 0;
      const bLogo = b.hasLogo ? 1 : 0;
      if (aLogo !== bLogo) {
        return bLogo - aLogo;
      }
    }
    if (a.source !== b.source) {
      if (a.source === "routescan") return -1;
      if (b.source === "routescan") return 1;
    }
    const aMatch = exactMatchScore(a, normalized);
    const bMatch = exactMatchScore(b, normalized);
    if (aMatch !== bMatch) {
      return bMatch - aMatch;
    }
    return a.title.localeCompare(b.title);
  });
}

function exactMatchScore(item: SearchResultItem, query: string): number {
  if (!query) {
    return 0;
  }
  const fields = [item.symbol, item.name, item.title, item.subtitle]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  if (fields.some((value) => value === query)) {
    return 2;
  }
  if (fields.some((value) => value.startsWith(query))) {
    return 1;
  }
  return 0;
}

function scoreItem(
  input: {
    kind: string;
    title: string;
    name?: string;
    symbol?: string;
    priority?: number;
    marketCap?: number;
    exchangeRate?: number;
    isVerified?: boolean;
  },
  query: string,
): number {
  let score = baseKindScore(input.kind);
  score += (input.priority ?? 0) * 25;
  if (input.marketCap) {
    score += Math.log10(input.marketCap + 1) * 40;
  }
  if (input.isVerified) {
    score += 20;
  }
  if (input.exchangeRate) {
    score += 5;
  }
  score += textMatchScore([input.title, input.name, input.symbol], query) * 120;
  return score;
}

function baseKindScore(kind: string): number {
  switch (kind) {
    case "token":
      return 1000;
    case "contract":
      return 850;
    case "address":
      return 800;
    case "transaction":
      return 650;
    case "block":
      return 500;
    default:
      return 0;
  }
}

function textMatchScore(values: Array<string | undefined>, query: string): number {
  if (!query) {
    return 0;
  }
  const normalized = query.toLowerCase();
  let score = 0;
  for (const value of values) {
    if (!value) {
      continue;
    }
    const lowered = value.toLowerCase();
    if (lowered === normalized) {
      score = Math.max(score, 2);
    } else if (lowered.startsWith(normalized)) {
      score = Math.max(score, 1.4);
    } else if (lowered.includes(normalized)) {
      score = Math.max(score, 1);
    }
  }
  return score;
}

function formatMarketCap(value?: number): string | undefined {
  if (!value || value <= 0) {
    return undefined;
  }
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toFixed(2)}`;
}

function formatExchangeRate(value?: number): string | undefined {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return undefined;
  }
  return `$${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function buildDetail(item: SearchResultItem): string | undefined {
  const parts: string[] = [];
  if (item.subtitle && item.subtitle !== item.title) {
    parts.push(item.subtitle);
  }
  const marketCap = formatMarketCap(item.marketCap);
  if (marketCap) {
    parts.push(`MCap ${marketCap}`);
  }
  const price = formatExchangeRate(item.exchangeRate);
  if (price) {
    parts.push(`Price ${price}`);
  }
  if (item.copyValue && item.kind !== "token") {
    parts.push(`Address ${item.copyValue}`);
  }
  if (item.source === "routescan") {
    parts.push("Routescan");
  }
  return parts.length > 0 ? parts.join(" | ") : undefined;
}

function tokenSignalBoost(item: SearchResultItem): number {
  if (item.kind !== "token") {
    return 0;
  }
  let boost = 0;
  if (item.isVerified) boost += 18;
  if (item.hasDefiLlamaPrice) boost += 16;
  if (item.marketCap && item.marketCap > 0) boost += 12;
  if (item.hasLogo) boost += 8;
  if (item.hasRoutescanMetadata) boost += 6;

  const sourceCount = countSources(item);
  if (sourceCount >= 2) boost += 12;
  if (sourceCount >= 3) boost += 12;
  return boost;
}

function countSources(item: SearchResultItem): number {
  let sources = 0;
  const hasBlockscoutData =
    item.isVerified || Boolean(item.exchangeRate) || Boolean(item.marketCap) || Boolean(item.hasLogo);
  if (hasBlockscoutData) {
    sources += 1;
  }
  if (item.hasDefiLlamaPrice) {
    sources += 1;
  }
  if (item.hasRoutescanMetadata) {
    sources += 1;
  }
  return sources;
}

function isLikelyTxHash(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function mapRoutescanAddress(chain: SearchChain, address: string): SearchResultItem | undefined {
  return {
    id: `${chain.chainId}:routescan:address:${address}`,
    chainId: chain.chainId,
    chainName: chain.name,
    kind: "address",
    title: shortenHash(address),
    subtitle: address,
    badge: "Address",
    entityType: "address",
    entityValue: address,
    copyValue: address,
    score: 1200,
    source: "routescan",
  };
}

function mapRoutescanTransaction(
  chain: SearchChain,
  txHash: string,
  data: { timestamp?: string },
): SearchResultItem | undefined {
  return {
    id: `${chain.chainId}:routescan:tx:${txHash}`,
    chainId: chain.chainId,
    chainName: chain.name,
    kind: "transaction",
    title: `Tx ${shortenHash(txHash)}`,
    subtitle: data.timestamp ?? "",
    badge: "Transaction",
    entityType: "tx",
    entityValue: txHash,
    copyValue: txHash,
    score: 900,
    source: "routescan",
  };
}

function buildRoutescanChain(chain: SearchChain): ChainConfig {
  return {
    chainId: chain.chainId,
    name: chain.name,
    nativeSymbol: "",
    rpcs: [],
    explorer: { kind: "routescan", baseUrl: "https://routescan.io" },
  };
}

function getNetworkIds(
  settings: ReturnType<typeof getSettings>["chains"],
): Array<ReturnType<typeof resolveNetworkId>> {
  const chains = resolveChains(settings);
  const ids = new Set<ReturnType<typeof resolveNetworkId>>();
  for (const chain of chains) {
    ids.add(resolveNetworkId(chain));
  }
  return Array.from(ids);
}

function toChainId(value?: string): ChainId | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function iconForKind(kind: string): vscode.ThemeIcon {
  switch (kind) {
    case "token":
      return new vscode.ThemeIcon("symbol-variable");
    case "contract":
      return new vscode.ThemeIcon("symbol-class");
    case "address":
      return new vscode.ThemeIcon("symbol-constant");
    case "transaction":
      return new vscode.ThemeIcon("symbol-event");
    case "block":
      return new vscode.ThemeIcon("symbol-number");
    default:
      return new vscode.ThemeIcon("symbol-misc");
  }
}
