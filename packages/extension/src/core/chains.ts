import type { ChainId, RpcUrl } from "@lighthouse/shared";

export type ExplorerKind = "routescan" | "etherscan" | "blockscout";

export interface ExplorerConfig {
  kind: ExplorerKind;
  baseUrl: string;
  apiBaseUrl?: string;
}

export interface ChainConfig {
  chainId: ChainId;
  name: string;
  nativeSymbol: string;
  rpcs: RpcUrl[];
  explorer?: ExplorerConfig;
  defillamaChainKey?: string;
}

export const DEFAULT_CHAINS: ChainConfig[] = [
  {
    chainId: 1,
    name: "Ethereum",
    nativeSymbol: "ETH",
    rpcs: ["https://eth.llamarpc.com"],
    explorer: {
      kind: "routescan",
      baseUrl: "https://routescan.io",
    },
    defillamaChainKey: "ethereum",
  },
  {
    chainId: 10,
    name: "Optimism",
    nativeSymbol: "ETH",
    rpcs: ["https://optimism.llamarpc.com"],
    explorer: {
      kind: "routescan",
      baseUrl: "https://routescan.io",
    },
    defillamaChainKey: "optimism",
  },
  {
    chainId: 137,
    name: "Polygon",
    nativeSymbol: "MATIC",
    rpcs: ["https://polygon.llamarpc.com"],
    explorer: {
      kind: "routescan",
      baseUrl: "https://routescan.io",
    },
    defillamaChainKey: "polygon",
  },
  {
    chainId: 42161,
    name: "Arbitrum",
    nativeSymbol: "ETH",
    rpcs: ["https://arbitrum.llamarpc.com"],
    explorer: {
      kind: "routescan",
      baseUrl: "https://routescan.io",
    },
    defillamaChainKey: "arbitrum",
  },
  {
    chainId: 8453,
    name: "Base",
    nativeSymbol: "ETH",
    rpcs: ["https://base.llamarpc.com"],
    explorer: {
      kind: "routescan",
      baseUrl: "https://routescan.io",
    },
    defillamaChainKey: "base",
  },
];

export function getDefaultChainMap(): Map<ChainId, ChainConfig> {
  return new Map(DEFAULT_CHAINS.map(chain => [chain.chainId, chain]));
}
