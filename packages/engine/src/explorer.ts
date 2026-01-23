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
};

export function buildExplorerUrl(
  address: Address,
  chain?: ChainConfig,
  preferred?: ExplorerKind,
): string {
  const baseUrl =
    chain?.explorer?.baseUrl ??
    (preferred === "etherscan" && chain ? ETHERSCAN_BY_CHAIN[chain.chainId] : undefined) ??
    DEFAULT_EXPLORER_BASE[preferred ?? "routescan"];
  const url = new URL(baseUrl);

  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  url.pathname = `${path}address/${address}`;

  if (
    chain?.chainId &&
    (chain?.explorer?.kind === "routescan" || (!chain?.explorer && preferred === "routescan"))
  ) {
    url.searchParams.set("chainId", String(chain.chainId));
  }

  return url.toString();
}
