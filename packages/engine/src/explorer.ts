import type { Address } from "@lighthouse/shared";

import type { ChainConfig, ExplorerKind } from "./chains";

const DEFAULT_EXPLORER_BASE: Record<ExplorerKind, string> = {
  routescan: "https://routescan.io",
  etherscan: "https://etherscan.io",
  blockscout: "https://blockscout.com",
};

const ETHERSCAN_BY_CHAIN: Record<number, string> = {
  1: "https://etherscan.io",
  10: "https://optimistic.etherscan.io",
  137: "https://polygonscan.com",
  42161: "https://arbiscan.io",
  8453: "https://basescan.org",
  100: "https://gnosis.blockscout.com",
};

export function buildExplorerUrl(
  address: Address,
  chain?: ChainConfig,
  preferred?: ExplorerKind,
): string {
  return buildExplorerEntityUrl("address", address, chain, preferred);
}

export function buildExplorerEntityUrl(
  kind: "address" | "tx" | "block",
  value: string,
  chain?: ChainConfig,
  preferred?: ExplorerKind,
): string {
  const baseUrl = resolveExplorerBaseUrl(chain, preferred);
  const url = new URL(baseUrl);

  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  url.pathname = `${path}${kind}/${value}`;

  if (chain?.chainId && baseUrl.includes("routescan")) {
    url.searchParams.set("chainId", String(chain.chainId));
  }

  return url.toString();
}

function resolveExplorerBaseUrl(chain?: ChainConfig, preferred?: ExplorerKind): string {
  const preferredKind = preferred ?? chain?.explorer?.kind ?? "routescan";
  const chainExplorer =
    chain?.explorer && (!preferred || chain.explorer.kind === preferredKind)
      ? chain.explorer.baseUrl
      : undefined;
  const etherscanUrl =
    preferredKind === "etherscan" && chain ? ETHERSCAN_BY_CHAIN[chain.chainId] : undefined;
  return etherscanUrl ?? chainExplorer ?? DEFAULT_EXPLORER_BASE[preferredKind];
}
