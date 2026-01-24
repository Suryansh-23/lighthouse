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

const BLOCKSCOUT_APIS: Record<number, string> = {
  1: "https://eth.blockscout.com/api/v2",
  10: "https://optimism.blockscout.com/api/v2",
  42161: "https://arbitrum.blockscout.com/api/v2",
  8453: "https://base.blockscout.com/api/v2",
  100: "https://gnosis.blockscout.com/api/v2",
};

export function registerSearch(context: vscode.ExtensionContext) {
  const controller = new SearchController();
  context.subscriptions.push(
    vscode.commands.registerCommand("lighthouse.search", async () => {
      await controller.open();
    }),
  );
}

class SearchController {
  private panel: vscode.WebviewPanel | undefined;
  private requestId = 0;
  private currentQuery = "";
  private resultsByChain = new Map<ChainId, SearchResultItem[]>();
  private nextPageByChain = new Map<ChainId, Record<string, string | number | null>>();
  private searchChains: SearchChain[] = [];
  private abortController: AbortController | undefined;

  async open() {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "lighthouseSearch",
        "Lighthouse Search",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    } else {
      this.panel.reveal(vscode.ViewColumn.Active);
    }

    this.panel.webview.html = renderSearchHtml();
    this.syncChains();
    this.postStatus();
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

  private async handleMessage(message: { type?: string; query?: string; item?: SearchResultItem }) {
    if (!message?.type) {
      return;
    }

    switch (message.type) {
      case "search":
        await this.startSearch(message.query ?? "");
        break;
      case "loadMore":
        await this.loadMore();
        break;
      case "open":
        if (message.item) {
          await this.openItem(message.item);
        }
        break;
      case "copy":
        if (message.item?.copyValue) {
          await vscode.env.clipboard.writeText(message.item.copyValue);
          void vscode.window.showInformationMessage("Lighthouse: Copied to clipboard.");
        }
        break;
      default:
        break;
    }
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
      this.postResults();
      return;
    }

    this.postStatus(true);
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
      this.postResults();
    });
    this.postStatus(false);
  }

  private async loadMore() {
    if (!this.currentQuery || this.nextPageByChain.size === 0) {
      return;
    }

    this.requestId += 1;
    const token = this.requestId;
    this.postStatus(true);
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
      this.postResults();
    });

    this.postStatus(false);
  }

  private postResults() {
    if (!this.panel) {
      return;
    }

    const items = interleaveResults(this.searchChains, this.resultsByChain, 80);
    const hasMore = this.nextPageByChain.size > 0;
    void this.panel.webview.postMessage({ type: "results", items, hasMore });
  }

  private postStatus(loading = false) {
    if (!this.panel) {
      return;
    }
    void this.panel.webview.postMessage({ type: "status", loading });
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
      subtitle: item.name ? `${item.name} · ${item.token_type}` : item.token_type,
      badge: item.is_smart_contract_verified ? "Verified" : "Token",
      iconUrl: item.icon_url,
      entityType: "address",
      entityValue: item.address_hash,
      copyValue: item.address_hash,
    };
  } else if (item.type === "address" || item.type === "contract") {
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
  } else if (item.type === "transaction") {
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

function renderSearchHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap" />
    <title>Lighthouse Search</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #1f252f;
        --muted: #5c6672;
        --panel: #ffffff;
        --page: #f4f2ee;
        --accent: #3b6ea5;
        --accent-soft: #e4eef9;
        --chip: #f0e7d8;
        --border: rgba(31, 37, 47, 0.1);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "Space Grotesk", "Segoe UI", sans-serif;
        color: var(--ink);
        background: radial-gradient(circle at top, #ffffff 0%, #f1efe9 60%, #efeae2 100%);
      }

      header {
        padding: 28px 32px 18px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      h1 {
        margin: 0;
        font-size: 22px;
        letter-spacing: 0.01em;
      }

      .search-bar {
        display: flex;
        align-items: center;
        gap: 12px;
        background: var(--panel);
        border-radius: 14px;
        padding: 12px 16px;
        border: 1px solid var(--border);
        box-shadow: 0 12px 30px rgba(31, 37, 47, 0.08);
      }

      .search-bar input {
        flex: 1;
        border: none;
        font-size: 15px;
        font-family: "IBM Plex Mono", "SF Mono", monospace;
        outline: none;
        background: transparent;
      }

      .status {
        font-size: 12px;
        color: var(--muted);
      }

      main {
        padding: 0 32px 32px;
      }

      .results {
        display: grid;
        gap: 12px;
      }

      .result {
        background: var(--panel);
        border-radius: 16px;
        padding: 14px 16px;
        border: 1px solid var(--border);
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 16px;
        align-items: center;
        cursor: pointer;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      }

      .result:hover {
        transform: translateY(-1px);
        box-shadow: 0 12px 24px rgba(31, 37, 47, 0.12);
      }

      .icon {
        width: 42px;
        height: 42px;
        border-radius: 12px;
        background: var(--accent-soft);
        display: grid;
        place-items: center;
        font-weight: 600;
        color: var(--accent);
        overflow: hidden;
        font-size: 12px;
        text-transform: uppercase;
      }

      .icon img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .meta {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .title {
        font-size: 15px;
        font-weight: 600;
      }

      .subtitle {
        font-size: 12px;
        color: var(--muted);
        font-family: "IBM Plex Mono", "SF Mono", monospace;
      }

      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
      }

      .tag {
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 999px;
        background: var(--chip);
      }

      .actions {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .copy {
        width: 28px;
        height: 28px;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: #fff;
        display: grid;
        place-items: center;
        font-size: 12px;
        cursor: pointer;
      }

      .empty {
        padding: 32px;
        text-align: center;
        color: var(--muted);
        border: 1px dashed var(--border);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.6);
      }

      .footer {
        display: flex;
        justify-content: center;
        margin-top: 20px;
      }

      .load-more {
        border: none;
        background: var(--accent);
        color: #fff;
        padding: 10px 18px;
        border-radius: 999px;
        font-size: 13px;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Lighthouse Search</h1>
      <div class="search-bar">
        <input id="query" type="text" placeholder="Search addresses, tokens, tx hashes, blocks" />
        <span class="status" id="status">Idle</span>
      </div>
    </header>
    <main>
      <div class="results" id="results"></div>
      <div class="footer" id="footer"></div>
    </main>
    <script>
      const vscode = acquireVsCodeApi();
      const queryInput = document.getElementById("query");
      const resultsEl = document.getElementById("results");
      const footerEl = document.getElementById("footer");
      const statusEl = document.getElementById("status");
      let currentItems = [];
      let hasMore = false;
      let debounce = null;

      queryInput.addEventListener("input", event => {
        const value = event.target.value;
        if (debounce) {
          clearTimeout(debounce);
        }
        debounce = setTimeout(() => {
          vscode.postMessage({ type: "search", query: value });
        }, 300);
      });

      window.addEventListener("message", event => {
        const message = event.data;
        if (message.type === "results") {
          currentItems = message.items || [];
          hasMore = Boolean(message.hasMore);
          render();
        }
        if (message.type === "status") {
          statusEl.textContent = message.loading ? "Searching..." : "Idle";
        }
      });

      function render() {
        resultsEl.innerHTML = "";
        if (currentItems.length === 0) {
          resultsEl.innerHTML = "<div class='empty'>No results yet. Start typing to search.</div>";
          footerEl.innerHTML = "";
          return;
        }
        currentItems.forEach(item => {
          const card = document.createElement("div");
          card.className = "result";
          card.addEventListener("click", () => {
            vscode.postMessage({ type: "open", item });
          });

          const icon = document.createElement("div");
          icon.className = "icon";
          if (item.iconUrl) {
            const img = document.createElement("img");
            img.src = item.iconUrl;
            img.alt = item.title;
            icon.appendChild(img);
          } else {
            icon.textContent = item.kind.slice(0, 2).toUpperCase();
          }

          const meta = document.createElement("div");
          meta.className = "meta";
          const title = document.createElement("div");
          title.className = "title";
          title.textContent = item.title;
          meta.appendChild(title);

          if (item.subtitle) {
            const subtitle = document.createElement("div");
            subtitle.className = "subtitle";
            subtitle.textContent = item.subtitle;
            meta.appendChild(subtitle);
          }

          const tags = document.createElement("div");
          tags.className = "tags";
          const chainTag = document.createElement("span");
          chainTag.className = "tag";
          chainTag.textContent = item.chainName;
          tags.appendChild(chainTag);
          if (item.badge) {
            const badgeTag = document.createElement("span");
            badgeTag.className = "tag";
            badgeTag.textContent = item.badge;
            tags.appendChild(badgeTag);
          }
          meta.appendChild(tags);

          const actions = document.createElement("div");
          actions.className = "actions";
          if (item.copyValue) {
            const copyBtn = document.createElement("button");
            copyBtn.className = "copy";
            copyBtn.textContent = "COPY";
            copyBtn.addEventListener("click", event => {
              event.stopPropagation();
              vscode.postMessage({ type: "copy", item });
            });
            actions.appendChild(copyBtn);
          }

          card.appendChild(icon);
          card.appendChild(meta);
          card.appendChild(actions);
          resultsEl.appendChild(card);
        });

        if (hasMore) {
          footerEl.innerHTML = "";
          const button = document.createElement("button");
          button.className = "load-more";
          button.textContent = "Load more";
          button.addEventListener("click", () => {
            vscode.postMessage({ type: "loadMore" });
          });
          footerEl.appendChild(button);
        } else {
          footerEl.innerHTML = "";
        }
      }
    </script>
  </body>
</html>`;
}
