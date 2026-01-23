import * as vscode from "vscode";

import type { AddressResolution, ChainAddressInfo } from "@lighthouse/shared";

import { extractAddressAtPosition } from "../core/extract";
import { getSettings } from "../core/settings";
import { toAbortSignal } from "../core/cancellation";
import { CacheStore } from "../data/cache-store";
import type { AddressBookStore } from "../data/address-book-store";
import type { AddressResolver } from "@lighthouse/engine";
import { selectPrimaryChain } from "./chain-selection";

interface HoverDeps {
  cache: CacheStore;
  resolver: AddressResolver;
  addressBook: AddressBookStore;
}

export function registerHover(context: vscode.ExtensionContext, deps: HoverDeps) {
  const selector: vscode.DocumentSelector = [
    { scheme: "file" },
    { scheme: "vscode-remote" },
  ];

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, {
      provideHover: async (doc, pos, token) => {
        const settings = getSettings();
        if (!settings.enabled || !settings.ui.hover.enabled) {
          return undefined;
        }

        const hit = extractAddressAtPosition(doc, pos);
        if (!hit) {
          return undefined;
        }

        const cached = deps.cache.get(hit.address);
        const notes = deps.addressBook.getNotes(hit.address);
        const md = buildHoverMarkdown(hit.address, cached, notes);
        const hover = new vscode.Hover(md, hit.range);

        if (!cached) {
          const signal = toAbortSignal(token);
          void deps.resolver.resolve(hit.address, { signal }).catch(() => undefined);
        }

        return hover;
      },
    }),
  );
}

function buildHoverMarkdown(
  address: string,
  resolution?: AddressResolution,
  notes?: string,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.supportThemeIcons = true;
  md.isTrusted = {
    enabledCommands: [
      "lighthouse.openExplorer",
      "lighthouse.copyAddress",
      "lighthouse.addToAddressBook",
      "lighthouse.inspectAddress",
    ],
  };

  md.appendMarkdown("**Lighthouse**\n\n");
  md.appendMarkdown(`\`${address}\`\n\n`);

  if (resolution) {
    const info = selectPrimaryChain(resolution);
    if (info) {
      const summary = formatSummary(info);
      md.appendMarkdown(`${summary}\n\n`);
      appendDeployment(md, info);
      appendTokenDetails(md, info);
    }
  } else {
    md.appendMarkdown("Resolving…\n\n");
  }

  if (notes) {
    const snippet = notes.length > 180 ? `${notes.slice(0, 180)}…` : notes;
    md.appendMarkdown(`**Notes**\n\n${escapeMarkdown(snippet)}\n\n`);
  }

  const args = encodeCommandArgs({ address });
  const openArgs = encodeCommandArgs({
    address,
    chainId: resolution?.scan.chainsSucceeded[0] ?? resolution?.scan.chainsAttempted[0],
  });

  md.appendMarkdown(
    `[Open Explorer](command:lighthouse.openExplorer?${openArgs}) | ` +
      `[Copy](command:lighthouse.copyAddress?${args}) | ` +
      `[Inspect](command:lighthouse.inspectAddress?${args}) | ` +
      `[Add](command:lighthouse.addToAddressBook?${args})`,
  );

  return md;
}

function formatSummary(info: ChainAddressInfo): string {
  const kind = info.kind === "Unknown" ? "Unknown" : info.kind;
  const base = `${info.chainName} (${info.chainId}) · ${kind}`;

  const classification = info.contract?.classification?.type;
  if (classification) {
    const tokenLabel = info.token?.symbol ? `${classification} (${info.token.symbol})` : classification;
    const price = info.token?.price?.usd;
    if (price !== undefined) {
      return `${base} · ${tokenLabel} · $${price.toFixed(2)}`;
    }
    return `${base} · ${tokenLabel}`;
  }

  return base;
}

function encodeCommandArgs(args: { address: string; chainId?: number }): string {
  return encodeURIComponent(JSON.stringify(args));
}

function appendDeployment(md: vscode.MarkdownString, info: ChainAddressInfo) {
  const deployment = info.contract?.deployment;
  if (!deployment) {
    return;
  }

  const details: string[] = [];
  if (deployment.blockNumber !== undefined) {
    details.push(`Block ${deployment.blockNumber}`);
  }
  if (deployment.creator) {
    details.push(`Creator ${deployment.creator}`);
  }
  if (deployment.txHash) {
    details.push(`Tx ${deployment.txHash}`);
  }

  if (details.length > 0) {
    md.appendMarkdown(`**Deployment**\n\n${details.join(" · ")}\n\n`);
  }
}

function appendTokenDetails(md: vscode.MarkdownString, info: ChainAddressInfo) {
  const token = info.token;
  if (!token) {
    return;
  }

  const lines: string[] = [];
  lines.push(`Standard: ${token.standard}`);
  if (token.name) lines.push(`Name: ${token.name}`);
  if (token.symbol) lines.push(`Symbol: ${token.symbol}`);
  if (token.decimals !== undefined) lines.push(`Decimals: ${token.decimals}`);
  if (token.totalSupply) lines.push(`Total supply: ${token.totalSupply}`);
  if (token.asset) lines.push(`Asset: ${token.asset}`);
  if (token.totalAssets) lines.push(`Total assets: ${token.totalAssets}`);
  if (token.price?.usd !== undefined) {
    lines.push(`Price: $${token.price.usd.toFixed(2)}`);
  }

  md.appendMarkdown(`**Token details**\n\n${lines.join("\n")}\n\n`);
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
}
