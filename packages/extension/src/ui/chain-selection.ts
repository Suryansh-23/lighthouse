import * as vscode from "vscode";

import type { AddressResolution, ChainAddressInfo } from "@lighthouse/shared";

interface ChainPickItem extends vscode.QuickPickItem {
  info: ChainAddressInfo;
}

export function selectPrimaryChain(resolution: AddressResolution): ChainAddressInfo | undefined {
  const candidates = getCandidateChains(resolution);
  if (candidates.length === 0) {
    return undefined;
  }

  const order = new Map<number, number>();
  resolution.scan.chainsAttempted.forEach((chainId, index) => {
    order.set(chainId, index);
  });

  return candidates
    .map(info => ({ info, score: scoreChain(info), order: order.get(info.chainId) ?? 999 }))
    .sort((a, b) => b.score - a.score || a.order - b.order)[0].info;
}

export function hasMultipleCandidateChains(resolution: AddressResolution): boolean {
  return getCandidateChains(resolution).length > 1;
}

export async function promptForChain(
  resolution: AddressResolution,
  title: string,
): Promise<ChainAddressInfo | undefined> {
  const candidates = getCandidateChains(resolution);
  if (candidates.length <= 1) {
    return candidates[0];
  }

  const items: ChainPickItem[] = candidates.map(info => ({
    info,
    label: `${info.chainName} (${info.chainId})`,
    description: buildChainDescriptor(info),
    detail: buildChainDetail(info),
  }));

  const pick = await vscode.window.showQuickPick(items, { title, placeHolder: "Select chain" });
  return pick?.info;
}

function getCandidateChains(resolution: AddressResolution): ChainAddressInfo[] {
  const chains = Object.values(resolution.perChain);
  const contractChains = chains.filter(info => info.isContract);
  return contractChains.length > 0 ? contractChains : chains;
}

function scoreChain(info: ChainAddressInfo): number {
  let score = 0;
  if (info.isContract) score += 3;
  if (info.contract?.classification) score += 2;
  if (info.token?.symbol) score += 1;
  if (info.token?.price?.usd !== undefined) score += 1;
  return score;
}

function buildChainDescriptor(info: ChainAddressInfo): string {
  const kind = info.kind === "Unknown" ? "Unknown" : info.kind;
  const classification = info.contract?.classification?.type;
  if (classification) {
    return `${kind} · ${classification}`;
  }
  return kind;
}

function buildChainDetail(info: ChainAddressInfo): string | undefined {
  const parts: string[] = [];
  if (info.token?.symbol) {
    parts.push(`Token: ${info.token.symbol}`);
  } else if (info.token?.name) {
    parts.push(`Token: ${info.token.name}`);
  }
  if (info.contract?.proxy?.implementation) {
    parts.push(`Proxy: ${info.contract.proxy.type}`);
  }
  return parts.length ? parts.join(" · ") : undefined;
}
