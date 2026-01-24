import * as vscode from "vscode";

import type { ChainId } from "@lighthouse/shared";

import { buildExplorerEntityUrl, getChainById, resolveChains } from "@lighthouse/engine";
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
  exchange_rate?: string;
  icon_url?: string;
  is_smart_contract_verified?: boolean;
  total_supply?: string;
}

interface BlockscoutAddress {
  type: "address" | "contract";
  address_hash: string;
  name?: string;
  is_smart_contract_verified?: boolean;
}

interface BlockscoutBlock {
  type: "block";
  block_hash: string;
  block_number?: number;
  timestamp?: string;
}

interface BlockscoutTransaction {
  type: "transaction";
  transaction_hash: string;
  timestamp?: string;
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
  private abortController: AbortController | undefined;
  private debounceHandle: NodeJS.Timeout | undefined;
  private quickPick: vscode.QuickPick<SearchQuickPickItem> | undefined;

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
    this.abortController?.abort();
    this.abortController = new AbortController();

    if (!this.currentQuery) {
      this.updateItems([createEmptyItem("Type to search")]);
      return;
    }

    this.setLoading(true);
    await runWithLimit(this.searchChains, 3, async (chain) => {
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
        this.resultsByChain.set(
          chain.chainId,
          response.items.map((item) => toSearchItem(chain, item)),
        );
        if (response.next_page_params && hasNextParams(response.next_page_params)) {
          this.nextPageByChain.set(chain.chainId, response.next_page_params);
        }
      }
      this.updateItems(this.buildItems());
    });
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
        const nextItems = response.items.map((item) => toSearchItem(chain, item));
        this.resultsByChain.set(chain.chainId, [...existing, ...nextItems]);
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
    void this.openItem(selected.data);
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
    const items = interleaveResults(this.searchChains, this.resultsByChain, 80).map((result) =>
      toQuickPickItem(result),
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
    this.searchChains = resolveChains(settings.chains)
      .filter((chain) => Boolean(BLOCKSCOUT_APIS[chain.chainId]))
      .map((chain) => ({
        chainId: chain.chainId,
        name: chain.name,
        apiBaseUrl: BLOCKSCOUT_APIS[chain.chainId],
      }));
  }
}

async function fetchSearch(
  chain: SearchChain,
  query: string,
  pageParams?: Record<string, string | number | null>,
  signal?: AbortSignal,
): Promise<SearchResponse | undefined> {
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

function toSearchItem(chain: SearchChain, item: BlockscoutItem): SearchResultItem {
  if (item.type === "token") {
    return {
      id: `${chain.chainId}:${item.type}:${item.address_hash}`,
      chainId: chain.chainId,
      chainName: chain.name,
      kind: item.type,
      title: item.symbol || item.name || "Token",
      subtitle: item.name ? `${item.name} | ${item.token_type}` : item.token_type,
      badge: item.is_smart_contract_verified ? "Verified" : "Token",
      iconUrl: item.icon_url,
      entityType: "address",
      entityValue: item.address_hash,
      copyValue: item.address_hash,
    };
  }

  if (item.type === "address" || item.type === "contract") {
    const title = item.name ? item.name : shortenHash(item.address_hash);
    const subtitle = item.name ? item.address_hash : "";
    return {
      id: `${chain.chainId}:${item.type}:${item.address_hash}`,
      chainId: chain.chainId,
      chainName: chain.name,
      kind: item.type,
      title,
      subtitle,
      badge: item.is_smart_contract_verified
        ? "Verified"
        : item.type === "contract"
          ? "Contract"
          : "Address",
      entityType: "address",
      entityValue: item.address_hash,
      copyValue: item.address_hash,
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
    };
  }

  if (item.type === "block") {
    return {
      id: `${chain.chainId}:${item.type}:${item.block_hash}`,
      chainId: chain.chainId,
      chainName: chain.name,
      kind: item.type,
      title: item.block_number
        ? `Block #${item.block_number}`
        : `Block ${shortenHash(item.block_hash)}`,
      subtitle: item.timestamp ?? "",
      badge: "Block",
      entityType: "block",
      entityValue: item.block_hash || String(item.block_number ?? ""),
      copyValue: item.block_hash || String(item.block_number ?? ""),
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
  };
}

function interleaveResults(
  chains: SearchChain[],
  resultsByChain: Map<ChainId, SearchResultItem[]>,
  limit: number,
): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  let index = 0;
  while (results.length < limit) {
    let added = false;
    for (const chain of chains) {
      const items = resultsByChain.get(chain.chainId) ?? [];
      if (index < items.length) {
        results.push(items[index]);
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
  return {
    label: item.title,
    description: descriptionParts.join(" | "),
    detail: item.subtitle,
    data: item,
    buttons: item.copyValue ? [COPY_BUTTON] : undefined,
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
