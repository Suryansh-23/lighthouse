import type { Address } from "@lighthouse/shared";

import type { ChainConfig, ExplorerKind } from "./chains";

const DEFAULT_EXPLORER_BASE: Record<ExplorerKind, string> = {
  routescan: "https://routescan.io",
  etherscan: "https://etherscan.io",
  blockscout: "https://blockscout.com",
};

export function buildExplorerUrl(
  address: Address,
  chain?: ChainConfig,
  preferred?: ExplorerKind,
): string {
  const baseUrl = chain?.explorer?.baseUrl ?? DEFAULT_EXPLORER_BASE[preferred ?? "routescan"];
  const url = new URL(baseUrl);

  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  url.pathname = `${path}address/${address}`;

  return url.toString();
}
