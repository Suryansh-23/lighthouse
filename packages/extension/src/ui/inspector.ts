import * as vscode from "vscode";

import type { Address, AddressResolution, ChainAddressInfo } from "@lighthouse/shared";

import { normalizeAddress } from "../core/addresses";
import { buildExplorerUrl } from "../core/explorer";
import { getChainById } from "../core/chain-config";
import { getSettings } from "../core/settings";
import type { AddressBookStore } from "../data/address-book-store";
import type { CacheStore } from "../data/cache-store";
import type { AddressResolver } from "../domain/resolve";

interface InspectorDeps {
  cache: CacheStore;
  resolver: AddressResolver;
  addressBook: AddressBookStore;
}

interface InspectorCommandArgs {
  address?: Address;
  chainId?: number;
}

interface InspectorState {
  address: Address;
  resolution?: AddressResolution;
  pinned: boolean;
  occurrences: number;
}

export class InspectorController {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly context: vscode.ExtensionContext, private readonly deps: InspectorDeps) {}

  async open(args?: InspectorCommandArgs): Promise<void> {
    const address = await this.resolveAddress(args?.address);
    if (!address) {
      return;
    }

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "lighthouseInspector",
        `Lighthouse: ${address}`,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: [this.context.extensionUri],
        },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage(message => this.handleMessage(message));
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.panel.title = `Lighthouse: ${address}`;
    }

    this.panel.webview.html = renderInspectorHtml(this.panel.webview, address);
    await this.pushState(address);
  }

  private async resolveAddress(value?: Address): Promise<Address | undefined> {
    if (value) {
      return value;
    }

    const input = await vscode.window.showInputBox({
      title: "Lighthouse: Inspect Address",
      prompt: "Enter an EVM address",
      placeHolder: "0x…",
    });

    if (!input) {
      return undefined;
    }

    const normalized = normalizeAddress(input.trim());
    if (!normalized) {
      void vscode.window.showErrorMessage("Lighthouse: Invalid address format.");
      return undefined;
    }

    return normalized;
  }

  private async pushState(address: Address): Promise<void> {
    const cached = this.deps.cache.get(address);
    await this.postState(address, cached);

    try {
      const resolution = await this.deps.resolver.resolve(address);
      await this.postState(address, resolution);
    } catch {
      // Ignore resolve failures for now.
    }
  }

  private async postState(address: Address, resolution?: AddressResolution): Promise<void> {
    if (!this.panel) {
      return;
    }

    const state: InspectorState = {
      address,
      resolution,
      pinned: this.deps.addressBook.isPinned(address),
      occurrences: this.deps.addressBook.getOccurrences(address).length,
    };

    await this.panel.webview.postMessage({ type: "state", state });
  }

  private async handleMessage(message: { type: string; action?: string; address?: Address }) {
    if (!message || message.type !== "command") {
      return;
    }

    const address = message.address;
    if (!address) {
      return;
    }

    const settings = getSettings();
    const cached = this.deps.cache.get(address);
    const chainId = cached?.scan.chainsSucceeded[0] ?? cached?.scan.chainsAttempted[0];

    switch (message.action) {
      case "copy":
        await vscode.env.clipboard.writeText(address);
        void vscode.window.showInformationMessage("Lighthouse: Address copied.");
        break;
      case "openExplorer": {
        const chain = chainId ? getChainById(chainId, settings) : undefined;
        const url = buildExplorerUrl(address, chain, settings.explorer.default);
        await vscode.env.openExternal(vscode.Uri.parse(url));
        break;
      }
      case "togglePin":
        if (this.deps.addressBook.isPinned(address)) {
          await this.deps.addressBook.removePinned(address);
        } else {
          await this.deps.addressBook.addPinned(address);
        }
        await this.postState(address, cached);
        break;
      default:
        break;
    }
  }
}

function renderInspectorHtml(webview: vscode.Webview, address: Address): string {
  const nonce = getNonce();
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style nonce="${nonce}">
      :root {
        color-scheme: light;
        --ink: #1f2833;
        --ink-muted: #56616b;
        --paper: #f5f1eb;
        --paper-strong: #efe6d8;
        --accent: #f2a149;
        --accent-strong: #d87b25;
        --line: rgba(34, 34, 34, 0.14);
        --chip: rgba(31, 40, 51, 0.08);
        --shadow: 0 20px 50px rgba(31, 40, 51, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "Avenir Next", "Gill Sans", "Segoe UI", sans-serif;
        color: var(--ink);
        background: var(--paper);
      }

      .shell {
        min-height: 100vh;
        padding: 32px 28px 48px;
        background:
          radial-gradient(circle at top right, rgba(242, 161, 73, 0.22), transparent 55%),
          radial-gradient(circle at 20% 40%, rgba(31, 40, 51, 0.12), transparent 50%),
          linear-gradient(135deg, #f7f2ea 0%, #efe6d8 100%);
      }

      .frame {
        max-width: 1100px;
        margin: 0 auto;
        padding: 32px;
        border-radius: 28px;
        background: rgba(255, 255, 255, 0.72);
        box-shadow: var(--shadow);
        border: 1px solid rgba(255, 255, 255, 0.7);
        backdrop-filter: blur(12px);
      }

      header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        padding-bottom: 24px;
        border-bottom: 1px solid var(--line);
      }

      .brand {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .brand span {
        font-size: 12px;
        letter-spacing: 0.28em;
        text-transform: uppercase;
        color: var(--ink-muted);
      }

      .brand h1 {
        font-family: "Iowan Old Style", "Palatino", "Times New Roman", serif;
        font-size: 30px;
        margin: 0;
      }

      .address {
        font-family: "SF Mono", "Menlo", monospace;
        font-size: 14px;
        color: var(--ink-muted);
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .btn {
        border: 1px solid var(--line);
        background: #fff7ec;
        color: var(--ink);
        padding: 8px 14px;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        border-radius: 999px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .btn.primary {
        background: var(--accent);
        color: #2b1d12;
        border-color: var(--accent-strong);
      }

      .btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 8px 16px rgba(242, 161, 73, 0.18);
      }

      .tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 24px;
      }

      .tab {
        border: 1px solid var(--line);
        background: #fff;
        color: var(--ink-muted);
        padding: 8px 16px;
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        border-radius: 999px;
        cursor: pointer;
      }

      .tab.active {
        background: var(--ink);
        color: #fdf6ee;
        border-color: var(--ink);
      }

      .panels {
        margin-top: 20px;
        display: grid;
      }

      .panel {
        display: none;
      }

      .panel.active {
        display: block;
      }

      .card {
        padding: 18px;
        border-radius: 18px;
        background: #fff;
        border: 1px solid var(--line);
        box-shadow: 0 12px 30px rgba(31, 40, 51, 0.08);
      }

      .card h2 {
        font-size: 14px;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        margin: 0 0 12px;
        color: var(--ink-muted);
      }

      .summary {
        font-size: 18px;
        font-family: "Iowan Old Style", "Palatino", serif;
        margin-bottom: 8px;
      }

      .chip-group {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }

      .chip {
        padding: 6px 10px;
        border-radius: 999px;
        background: var(--chip);
        font-size: 12px;
      }

      .list {
        display: grid;
        gap: 8px;
      }

      .list-item {
        padding: 10px 12px;
        border-radius: 12px;
        background: var(--paper-strong);
        font-size: 13px;
      }

      .muted {
        color: var(--ink-muted);
        font-size: 12px;
      }

      .empty {
        font-style: italic;
        color: var(--ink-muted);
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="frame">
        <header>
          <div class="brand">
            <span>Lighthouse</span>
            <h1>Inspector</h1>
            <div class="address" id="address">${address}</div>
          </div>
          <div class="actions">
            <button class="btn" data-action="copy">Copy</button>
            <button class="btn" data-action="openExplorer">Explorer</button>
            <button class="btn primary" data-action="togglePin" id="pinBtn">Pin</button>
          </div>
        </header>

        <div class="tabs">
          <button class="tab active" data-tab="overview">Overview</button>
          <button class="tab" data-tab="chains">Chains</button>
          <button class="tab" data-tab="contract">Contract</button>
          <button class="tab" data-tab="token">Token</button>
          <button class="tab" data-tab="occurrences">Occurrences</button>
          <button class="tab" data-tab="notes">Notes</button>
        </div>

        <div class="panels">
          <section class="card panel active" data-panel="overview">
            <h2>Overview</h2>
            <div class="summary" id="summary">Waiting for resolution…</div>
            <div class="chip-group" id="overviewChips"></div>
            <div class="muted" id="occurrences">Occurrences: 0</div>
          </section>
          <section class="card panel" data-panel="chains">
            <h2>Chains</h2>
            <div class="list" id="chainList"></div>
          </section>
          <section class="card panel" data-panel="contract">
            <h2>Contract</h2>
            <div class="list" id="contractList"></div>
          </section>
          <section class="card panel" data-panel="token">
            <h2>Token</h2>
            <div class="list" id="tokenList"></div>
          </section>
          <section class="card panel" data-panel="occurrences">
            <h2>Occurrences</h2>
            <div class="muted" id="occurrenceSummary">No occurrences yet.</div>
            <div class="list" id="occurrenceList"></div>
          </section>
          <section class="card panel" data-panel="notes">
            <h2>Notes</h2>
            <div class="muted">Notes support lands in Phase 4+.</div>
          </section>
        </div>
      </div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      let currentState = { address: "${address}", pinned: false, occurrences: 0 };

      const summaryEl = document.getElementById("summary");
      const addressEl = document.getElementById("address");
      const chainList = document.getElementById("chainList");
      const contractList = document.getElementById("contractList");
      const tokenList = document.getElementById("tokenList");
      const overviewChips = document.getElementById("overviewChips");
      const pinBtn = document.getElementById("pinBtn");
      const occurrencesEl = document.getElementById("occurrences");
      const occurrenceList = document.getElementById("occurrenceList");
      const occurrenceSummary = document.getElementById("occurrenceSummary");
      const tabs = Array.from(document.querySelectorAll(".tab"));
      const panels = Array.from(document.querySelectorAll(".panel"));

      window.addEventListener("message", event => {
        const { type, state } = event.data || {};
        if (type !== "state" || !state) {
          return;
        }
        currentState = state;
        render(state);
      });

      document.querySelectorAll("[data-action]").forEach(button => {
        button.addEventListener("click", () => {
          const action = button.getAttribute("data-action");
          vscode.postMessage({ type: "command", action, address: currentState.address });
        });
      });

      tabs.forEach(tab => {
        tab.addEventListener("click", () => {
          const key = tab.getAttribute("data-tab");
          setActiveTab(key);
        });
      });

      setActiveTab("overview");

      function setActiveTab(key) {
        tabs.forEach(tab => tab.classList.toggle("active", tab.getAttribute("data-tab") === key));
        panels.forEach(panel => panel.classList.toggle("active", panel.getAttribute("data-panel") === key));
      }

      function render(state) {
        addressEl.textContent = state.address;
        pinBtn.textContent = state.pinned ? "Unpin" : "Pin";
        occurrencesEl.textContent = `Occurrences: ${state.occurrences}`;
        occurrenceSummary.textContent =
          state.occurrences > 0
            ? `Found ${state.occurrences} occurrences in this workspace.`
            : "No occurrences yet.";
        occurrenceList.innerHTML = "";
        if (state.occurrences > 0) {
          const item = document.createElement("div");
          item.className = "list-item";
          item.textContent = "Use the Address Book view to reveal occurrences.";
          occurrenceList.appendChild(item);
        }

        const resolution = state.resolution;
        if (!resolution || !resolution.perChain) {
          summaryEl.textContent = "Waiting for resolution…";
          chainList.innerHTML = "<div class='empty'>No chain data yet.</div>";
          contractList.innerHTML = "<div class='empty'>No contract data yet.</div>";
          tokenList.innerHTML = "<div class='empty'>No token data yet.</div>";
          overviewChips.innerHTML = "";
          return;
        }

        const primary = resolution.perChain[resolution.scan.chainsSucceeded[0] || resolution.scan.chainsAttempted[0]];
        if (primary) {
          const classification = primary.contract && primary.contract.classification;
          const token = primary.token;
          const price = token && token.price && token.price.usd !== undefined ? `$${token.price.usd.toFixed(2)}` : "";
          summaryEl.textContent = `${primary.chainName} (${primary.chainId}) · ${primary.kind}` +
            (classification ? ` · ${classification.type}` : "") +
            (token && token.symbol ? ` (${token.symbol})` : "") +
            (price ? ` · ${price}` : "");
        }

        overviewChips.innerHTML = "";
        const chips = [
          `Chains scanned: ${resolution.scan.chainsAttempted.length}`,
          `Success: ${resolution.scan.chainsSucceeded.length}`,
          `Failures: ${resolution.scan.chainsFailed.length}`,
        ];
        chips.forEach(chip => {
          const el = document.createElement("div");
          el.className = "chip";
          el.textContent = chip;
          overviewChips.appendChild(el);
        });

        chainList.innerHTML = "";
        Object.values(resolution.perChain).forEach(info => {
          const item = document.createElement("div");
          item.className = "list-item";
          const classification = info.contract && info.contract.classification ? ` · ${info.contract.classification.type}` : "";
          item.textContent = `${info.chainName} (${info.chainId}) · ${info.kind}${classification}`;
          chainList.appendChild(item);
        });
        if (!Object.values(resolution.perChain).length) {
          chainList.innerHTML = "<div class='empty'>No chain data.</div>";
        }

        contractList.innerHTML = "";
        if (primary && primary.contract) {
          const items = [];
          if (primary.contract.bytecodeHash) {
            items.push(`Bytecode hash: ${primary.contract.bytecodeHash.slice(0, 12)}…`);
          }
          if (primary.contract.proxy && primary.contract.proxy.implementation) {
            items.push(`Proxy: ${primary.contract.proxy.type} → ${primary.contract.proxy.implementation}`);
          }
          if (primary.contract.metadata && primary.contract.metadata.contractName) {
            items.push(`Name: ${primary.contract.metadata.contractName}`);
          }
          if (primary.contract.metadata && primary.contract.metadata.verified !== undefined) {
            items.push(`Verified: ${primary.contract.metadata.verified ? "yes" : "no"}`);
          }
          if (items.length === 0) {
            contractList.innerHTML = "<div class='empty'>No contract metadata.</div>";
          } else {
            items.forEach(text => {
              const item = document.createElement("div");
              item.className = "list-item";
              item.textContent = text;
              contractList.appendChild(item);
            });
          }
        } else {
          contractList.innerHTML = "<div class='empty'>No contract metadata.</div>";
        }

        tokenList.innerHTML = "";
        if (primary && primary.token) {
          const items = [];
          items.push(`Standard: ${primary.token.standard}`);
          if (primary.token.name) items.push(`Name: ${primary.token.name}`);
          if (primary.token.symbol) items.push(`Symbol: ${primary.token.symbol}`);
          if (primary.token.decimals !== undefined) items.push(`Decimals: ${primary.token.decimals}`);
          if (primary.token.totalSupply) items.push(`Supply: ${primary.token.totalSupply}`);
          if (primary.token.price && primary.token.price.usd !== undefined) {
            items.push(`Price: $${primary.token.price.usd.toFixed(2)}`);
          }
          items.forEach(text => {
            const item = document.createElement("div");
            item.className = "list-item";
            item.textContent = text;
            tokenList.appendChild(item);
          });
        } else {
          tokenList.innerHTML = "<div class='empty'>No token data.</div>";
        }
      }
    </script>
  </body>
</html>`;
}

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
