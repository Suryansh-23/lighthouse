import * as vscode from "vscode";

import type { Address, AddressResolution } from "@lighthouse/shared";

import { buildExplorerUrl, getChainById, normalizeAddress } from "@lighthouse/engine";
import { getSettings } from "../core/settings";
import type { AddressBookStore } from "../data/address-book-store";
import type { CacheStore } from "../data/cache-store";
import type { AddressResolver } from "@lighthouse/engine";
import { hasMultipleCandidateChains, promptForChain } from "./chain-selection";

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
  notes?: string;
}

export class InspectorController {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly context: vscode.ExtensionContext, private readonly deps: InspectorDeps) {}

  async open(args?: InspectorCommandArgs): Promise<void> {
    const address = await this.resolveAddress(args?.address);
    if (!address) {
      return;
    }

    const resolution = await this.deps.resolver.resolve(address).catch(() => undefined);
    const preferred = args?.chainId && resolution ? resolution.perChain[args.chainId] : undefined;
    const chainInfo = preferred
      ? preferred
      : resolution
        ? await promptForChain(resolution, "Select chain to open explorer")
        : undefined;
    if (resolution && hasMultipleCandidateChains(resolution) && !chainInfo) {
      return;
    }
    const settings = getSettings();
    const chain = chainInfo ? getChainById(chainInfo.chainId, settings.chains) : undefined;
    const explorerUrl = buildExplorerUrl(address, chain, settings.explorer.default);

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "lighthouseExplorer",
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

    const notes = this.deps.addressBook.getNotes(address);
    this.panel.webview.html = renderExplorerHtml(
      this.panel.webview,
      address,
      explorerUrl,
      notes ?? "",
    );
    await this.postState(address, resolution);
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
      notes: this.deps.addressBook.getNotes(address),
    };

    await this.panel.webview.postMessage({ type: "state", state });
  }

  private async handleMessage(message: { type: string; action?: string; address?: Address; notes?: string }) {
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
        const chain = chainId ? getChainById(chainId, settings.chains) : undefined;
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
      case "saveNotes":
        if (typeof message.notes === "string") {
          await this.deps.addressBook.setNotes(address, message.notes.trim());
        }
        await this.postState(address, cached);
        break;
      default:
        break;
    }
  }
}

function renderExplorerHtml(
  webview: vscode.Webview,
  address: Address,
  explorerUrl: string,
  notes: string,
): string {
  const nonce = getNonce();
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    "frame-src https:",
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
        max-width: 1200px;
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

      .layout {
        display: grid;
        grid-template-columns: minmax(220px, 320px) 1fr;
        gap: 24px;
        margin-top: 24px;
      }

      .panel {
        padding: 18px;
        border-radius: 18px;
        background: #fff;
        border: 1px solid var(--line);
        box-shadow: 0 12px 30px rgba(31, 40, 51, 0.08);
      }

      .panel h2 {
        font-size: 14px;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        margin: 0 0 12px;
        color: var(--ink-muted);
      }

      .notes {
        width: 100%;
        min-height: 160px;
        border-radius: 12px;
        border: 1px solid var(--line);
        padding: 10px;
        font-family: "SF Mono", "Menlo", monospace;
        font-size: 12px;
        background: #fffdf8;
      }

      iframe {
        width: 100%;
        height: 640px;
        border: none;
        border-radius: 18px;
        box-shadow: 0 18px 40px rgba(31, 40, 51, 0.16);
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

        <div class="layout">
          <section class="panel">
            <h2>Overview</h2>
            <div class="summary" id="summary">Waiting for resolution…</div>
            <div class="chip-group" id="overviewChips"></div>
            <div class="muted" id="occurrences">Occurrences: 0</div>
            <div class="list" id="chainList"></div>
            <h2>Notes</h2>
            <textarea class="notes" id="notes" placeholder="Write notes for this address...">${escapeHtml(notes)}</textarea>
            <div class="muted">Notes are stored locally in workspace storage.</div>
          </section>
          <section>
            <iframe src="${escapeHtml(explorerUrl)}" title="Explorer"></iframe>
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
      const overviewChips = document.getElementById("overviewChips");
      const pinBtn = document.getElementById("pinBtn");
      const occurrencesEl = document.getElementById("occurrences");
      const notesEl = document.getElementById("notes");

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

      let notesTimeout = null;
      notesEl.addEventListener("input", () => {
        if (notesTimeout) {
          clearTimeout(notesTimeout);
        }
        notesTimeout = setTimeout(() => {
          vscode.postMessage({
            type: "command",
            action: "saveNotes",
            address: currentState.address,
            notes: notesEl.value,
          });
        }, 400);
      });

      function render(state) {
        addressEl.textContent = state.address;
        pinBtn.textContent = state.pinned ? "Unpin" : "Pin";
        occurrencesEl.textContent = "Occurrences: " + state.occurrences;
        if (typeof state.notes === "string" && notesEl.value !== state.notes) {
          notesEl.value = state.notes;
        }
        const resolution = state.resolution;
        if (!resolution || !resolution.perChain) {
          summaryEl.textContent = "Waiting for resolution…";
          overviewChips.innerHTML = "";
          return;
        }

        const primary = resolution.perChain[resolution.scan.chainsSucceeded[0] || resolution.scan.chainsAttempted[0]];
        if (primary) {
          const classification = primary.contract && primary.contract.classification;
          const token = primary.token;
          const price =
            token && token.price && token.price.usd !== undefined
              ? "$" + token.price.usd.toFixed(2)
              : "";
          let summary =
            primary.chainName + " (" + primary.chainId + ") · " + primary.kind;
          if (classification) {
            summary += " · " + classification.type;
          }
          if (token && token.symbol) {
            summary += " (" + token.symbol + ")";
          }
          if (price) {
            summary += " · " + price;
          }
          summaryEl.textContent = summary;
        }

        overviewChips.innerHTML = "";
        const chips = [
          "Chains scanned: " + resolution.scan.chainsAttempted.length,
          "Success: " + resolution.scan.chainsSucceeded.length,
          "Failures: " + resolution.scan.chainsFailed.length,
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
          const classification =
            info.contract && info.contract.classification
              ? " · " + info.contract.classification.type
              : "";
          item.textContent =
            info.chainName + " (" + info.chainId + ") · " + info.kind + classification;
          chainList.appendChild(item);
        });
        if (!Object.values(resolution.perChain).length) {
          chainList.innerHTML = "<div class='empty'>No chain data.</div>";
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
