import type { Address } from "@lighthouse/shared";

import type { ChainConfig } from "./chains";
import { RateLimiter } from "./rate-limit";

const ROUTESCAN_API_BASE = "https://api.routescan.io";
const ROUTESCAN_DEFAULT_NETWORK = "mainnet";

const DEFAULT_RATE_LIMIT = {
  maxRequests: 2,
  perMs: 1000,
};

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

export type RoutescanNetworkId = "mainnet" | "testnet" | "1" | "5";

export type RoutescanEndpointKey =
  | "addresses"
  | "address"
  | "transactions"
  | "transaction"
  | "erc20"
  | "erc721"
  | "erc1155"
  | "contracts";

export interface RoutescanClientConfig {
  apiKey?: string;
  rateLimit?: { maxRequests: number; perMs: number };
  cooldownMs?: number;
}

export interface RoutescanAddressSummary {
  chainId?: string;
  address?: string;
  balance?: string;
  balanceValueUsd?: string;
  name?: string;
}

export interface RoutescanAddressDetail {
  address?: string;
  balance?: string;
  firstActivity?: string;
  transactionsCount?: number;
  erc20TransfersCount?: number;
  erc721TransfersCount?: number;
  erc1155TransfersCount?: number;
}

export interface RoutescanTransactionDetail {
  type?: string;
  id?: string;
  chainId?: string;
  timestamp?: string;
  blockNumber?: number;
  blockHash?: string;
  index?: number;
  from?: string;
  to?: string;
  value?: string;
  gasUsed?: string;
  gasPrice?: string;
  gasLimit?: string;
  burnedFees?: string;
  status?: boolean;
  methodId?: string;
  method?: string;
  contractVerified?: boolean;
}

export interface RoutescanTokenSummary {
  chainId?: string;
  address?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  totalSupply?: string;
  price?: string;
  marketCap?: string;
  holdersCount?: number;
  createOperation?: {
    timestamp?: string;
    txHash?: string;
  };
}

export interface RoutescanContractSummary {
  chainId?: string;
  address?: string;
  name?: string;
  verified?: boolean;
  verifiedAt?: string;
  txCount?: number;
  createOperation?: {
    timestamp?: string;
    txHash?: string;
    from?: string;
    type?: string;
  };
  hasConstructorArguments?: boolean;
  licenseType?: string;
  compilerName?: string;
  compilerVersion?: string;
}

export interface RoutescanListResponse<T> {
  items: T[];
  count?: number;
  countType?: string;
  link?: {
    next?: string;
    nextToken?: string;
    prev?: string;
    prevToken?: string;
  };
}

interface EtherscanResponse<T> {
  status: string;
  message: string;
  result: T;
}

interface EtherscanSourceResult {
  ContractName?: string;
  ABI?: string;
  SourceCode?: string;
}

interface EtherscanCreationResult {
  contractAddress?: string;
  contractCreator?: string;
  txHash?: string;
}

export interface RoutescanContractMetadata {
  verified?: boolean;
  contractName?: string;
  abi?: unknown;
  sourceUrl?: string;
}

export interface RoutescanContractCreation {
  contractAddress?: string;
  contractCreator?: string;
  txHash?: string;
}

export class RoutescanClient {
  private apiKey?: string;
  private readonly limiter: RateLimiter;
  private readonly cooldownMs: number;
  private cooldownUntil?: number;
  private readonly supportsAllByEndpoint = new Map<RoutescanEndpointKey, boolean>();

  constructor(config: RoutescanClientConfig = {}) {
    this.apiKey = config.apiKey;
    this.limiter = new RateLimiter(config.rateLimit ?? DEFAULT_RATE_LIMIT);
    this.cooldownMs = config.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  setApiKey(value?: string) {
    this.apiKey = value;
  }

  async getAddressSummary(
    chain: ChainConfig,
    address: Address,
    signal?: AbortSignal,
  ): Promise<RoutescanAddressDetail | undefined> {
    return this.getAddressSummaryWithChain(chain, address, signal);
  }

  async getAddressSummaryAll(
    networkId: RoutescanNetworkId,
    address: Address,
    signal?: AbortSignal,
  ): Promise<RoutescanAddressDetail | undefined> {
    return this.getAddressSummaryWithPath(networkId, "all", address, "address", signal);
  }

  async getTransaction(
    chain: ChainConfig,
    txHash: string,
    signal?: AbortSignal,
  ): Promise<RoutescanTransactionDetail | undefined> {
    return this.getTransactionWithChain(chain, txHash, signal);
  }

  async getTransactionAll(
    networkId: RoutescanNetworkId,
    txHash: string,
    signal?: AbortSignal,
  ): Promise<RoutescanTransactionDetail | undefined> {
    return this.getTransactionWithPath(networkId, "all", txHash, "transaction", signal);
  }

  async listErc20Tokens(
    networkId: RoutescanNetworkId,
    chainId: string,
    params?: Record<string, string | number | boolean | undefined>,
    signal?: AbortSignal,
  ): Promise<RoutescanListResponse<RoutescanTokenSummary> | undefined> {
    return this.fetchList("erc20", networkId, chainId, params, signal);
  }

  async listErc721Tokens(
    networkId: RoutescanNetworkId,
    chainId: string,
    params?: Record<string, string | number | boolean | undefined>,
    signal?: AbortSignal,
  ): Promise<RoutescanListResponse<RoutescanTokenSummary> | undefined> {
    return this.fetchList("erc721", networkId, chainId, params, signal);
  }

  async listErc1155Tokens(
    networkId: RoutescanNetworkId,
    chainId: string,
    params?: Record<string, string | number | boolean | undefined>,
    signal?: AbortSignal,
  ): Promise<RoutescanListResponse<RoutescanTokenSummary> | undefined> {
    return this.fetchList("erc1155", networkId, chainId, params, signal);
  }

  async listAddresses(
    networkId: RoutescanNetworkId,
    chainId: string,
    params?: Record<string, string | number | boolean | undefined>,
    signal?: AbortSignal,
  ): Promise<RoutescanListResponse<RoutescanAddressSummary> | undefined> {
    return this.fetchList("addresses", networkId, chainId, params, signal);
  }

  async listContracts(
    networkId: RoutescanNetworkId,
    chainId: string,
    params?: Record<string, string | number | boolean | undefined>,
    signal?: AbortSignal,
  ): Promise<RoutescanListResponse<RoutescanContractSummary> | undefined> {
    return this.fetchList("contracts", networkId, chainId, params, signal);
  }

  async getContractMetadata(
    chain: ChainConfig,
    address: Address,
    signal?: AbortSignal,
  ): Promise<RoutescanContractMetadata | undefined> {
    const apiBase = this.getEtherscanApiBase(chain);
    if (!apiBase) {
      return undefined;
    }

    const url = new URL(apiBase);
    url.searchParams.set("module", "contract");
    url.searchParams.set("action", "getsourcecode");
    url.searchParams.set("address", address);
    this.appendApiKey(url);

    const response = await this.fetchEtherscan<EtherscanSourceResult[]>(url.toString(), signal);
    if (!response || !Array.isArray(response.result) || response.result.length === 0) {
      return undefined;
    }

    const result = response.result[0] ?? {};
    const verified = result.ABI ? !result.ABI.includes("Contract source code not verified") : false;
    return {
      verified,
      contractName: result.ContractName,
      abi: verified && result.ABI ? safeParseAbi(result.ABI) : undefined,
      sourceUrl: chain.explorer?.baseUrl
        ? `${chain.explorer.baseUrl}/address/${address}`
        : undefined,
    };
  }

  async getContractCreation(
    chain: ChainConfig,
    address: Address,
    signal?: AbortSignal,
  ): Promise<RoutescanContractCreation | undefined> {
    const apiBase = this.getEtherscanApiBase(chain);
    if (!apiBase) {
      return undefined;
    }

    const url = new URL(apiBase);
    url.searchParams.set("module", "contract");
    url.searchParams.set("action", "getcontractcreation");
    url.searchParams.set("contractaddresses", address);
    this.appendApiKey(url);

    const response = await this.fetchEtherscan<EtherscanCreationResult[]>(url.toString(), signal);
    if (!response || !Array.isArray(response.result) || response.result.length === 0) {
      return undefined;
    }

    return response.result[0];
  }

  async resolveAddressAllChains(
    chain: ChainConfig,
    address: Address,
    signal?: AbortSignal,
  ): Promise<RoutescanAddressDetail | undefined> {
    return this.fetchAddressWithAllFallback(chain, address, signal);
  }

  async resolveTransactionAllChains(
    chain: ChainConfig,
    txHash: string,
    signal?: AbortSignal,
  ): Promise<RoutescanTransactionDetail | undefined> {
    return this.fetchTransactionWithAllFallback(chain, txHash, signal);
  }

  private async fetchAddressWithAllFallback(
    chain: ChainConfig,
    address: Address,
    signal?: AbortSignal,
  ): Promise<RoutescanAddressDetail | undefined> {
    const networkId = resolveNetworkId(chain);
    const preferAll = this.supportsAllByEndpoint.get("address");
    if (preferAll !== false) {
      const result = await this.fetchJsonWithStatus<RoutescanAddressDetail>(
        `${ROUTESCAN_API_BASE}/v2/network/${networkId}/evm/all/addresses/${address}`,
        "address",
        signal,
      );
      if (result.data) {
        this.supportsAllByEndpoint.set("address", true);
        return result.data;
      }
      if (isUnsupportedAllStatus(result.status)) {
        this.supportsAllByEndpoint.set("address", false);
      }
    }

    return this.getAddressSummaryWithChain(chain, address, signal);
  }

  private async fetchTransactionWithAllFallback(
    chain: ChainConfig,
    txHash: string,
    signal?: AbortSignal,
  ): Promise<RoutescanTransactionDetail | undefined> {
    const networkId = resolveNetworkId(chain);
    const preferAll = this.supportsAllByEndpoint.get("transaction");
    if (preferAll !== false) {
      const result = await this.fetchJsonWithStatus<RoutescanTransactionDetail>(
        `${ROUTESCAN_API_BASE}/v2/network/${networkId}/evm/all/transactions/${txHash}`,
        "transaction",
        signal,
      );
      if (result.data) {
        this.supportsAllByEndpoint.set("transaction", true);
        return result.data;
      }
      if (isUnsupportedAllStatus(result.status)) {
        this.supportsAllByEndpoint.set("transaction", false);
      }
    }

    return this.getTransactionWithChain(chain, txHash, signal);
  }

  private async getAddressSummaryWithChain(
    chain: ChainConfig,
    address: Address,
    signal?: AbortSignal,
  ): Promise<RoutescanAddressDetail | undefined> {
    const networkId = resolveNetworkId(chain);
    const chainId = String(chain.chainId);
    return this.getAddressSummaryWithPath(networkId, chainId, address, "address", signal);
  }

  private async getTransactionWithChain(
    chain: ChainConfig,
    txHash: string,
    signal?: AbortSignal,
  ): Promise<RoutescanTransactionDetail | undefined> {
    const networkId = resolveNetworkId(chain);
    const chainId = String(chain.chainId);
    return this.getTransactionWithPath(networkId, chainId, txHash, "transaction", signal);
  }

  private async getAddressSummaryWithPath(
    networkId: RoutescanNetworkId,
    chainId: string,
    address: Address,
    endpoint: RoutescanEndpointKey,
    signal?: AbortSignal,
  ): Promise<RoutescanAddressDetail | undefined> {
    const url = new URL(
      `${ROUTESCAN_API_BASE}/v2/network/${networkId}/evm/${chainId}/addresses/${address}`,
    );
    return this.fetchJson<RoutescanAddressDetail>(url.toString(), endpoint, signal);
  }

  private async getTransactionWithPath(
    networkId: RoutescanNetworkId,
    chainId: string,
    txHash: string,
    endpoint: RoutescanEndpointKey,
    signal?: AbortSignal,
  ): Promise<RoutescanTransactionDetail | undefined> {
    const url = new URL(
      `${ROUTESCAN_API_BASE}/v2/network/${networkId}/evm/${chainId}/transactions/${txHash}`,
    );
    return this.fetchJson<RoutescanTransactionDetail>(url.toString(), endpoint, signal);
  }

  private async fetchList<T>(
    endpoint: RoutescanEndpointKey,
    networkId: RoutescanNetworkId,
    chainId: string,
    params?: Record<string, string | number | boolean | undefined>,
    signal?: AbortSignal,
  ): Promise<RoutescanListResponse<T> | undefined> {
    const url = new URL(`${ROUTESCAN_API_BASE}/v2/network/${networkId}/evm/${chainId}/${endpoint}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) {
          continue;
        }
        url.searchParams.set(key, String(value));
      }
    }
    return this.fetchJson<RoutescanListResponse<T>>(url.toString(), endpoint, signal);
  }

  private async fetchJson<T>(
    url: string,
    endpoint: RoutescanEndpointKey,
    signal?: AbortSignal,
  ): Promise<T | undefined> {
    const result = await this.fetchJsonWithStatus<T>(url, endpoint, signal);
    return result.data;
  }

  private async fetchJsonWithStatus<T>(
    url: string,
    endpoint: RoutescanEndpointKey,
    signal?: AbortSignal,
  ): Promise<{ data?: T; status: number }> {
    if (this.isCoolingDown()) {
      return { status: 429 };
    }
    await this.limiter.acquire(signal);

    try {
      const response = await fetch(url, { signal });
      if (response.status === 429) {
        this.startCooldown();
        return { status: response.status };
      }
      if (!response.ok) {
        return { status: response.status };
      }
      return { status: response.status, data: (await response.json()) as T };
    } catch {
      return { status: 0 };
    }
  }

  private async fetchEtherscan<T>(
    url: string,
    signal?: AbortSignal,
  ): Promise<EtherscanResponse<T> | undefined> {
    if (this.isCoolingDown()) {
      return undefined;
    }
    await this.limiter.acquire(signal);

    try {
      const response = await fetch(url, { signal });
      if (response.status === 429) {
        this.startCooldown();
        return undefined;
      }
      if (!response.ok) {
        return undefined;
      }
      return (await response.json()) as EtherscanResponse<T>;
    } catch {
      return undefined;
    }
  }

  private appendApiKey(url: URL) {
    if (this.apiKey) {
      url.searchParams.set("apikey", this.apiKey);
    }
  }

  private getEtherscanApiBase(chain: ChainConfig): string | undefined {
    const networkId = resolveNetworkId(chain);
    return `${ROUTESCAN_API_BASE}/v2/network/${networkId}/evm/${chain.chainId}/etherscan/api`;
  }

  private isCoolingDown(): boolean {
    return Boolean(this.cooldownUntil && Date.now() < this.cooldownUntil);
  }

  private startCooldown() {
    this.cooldownUntil = Date.now() + this.cooldownMs;
  }
}

export function resolveNetworkId(chain: ChainConfig): RoutescanNetworkId {
  const name = chain.name.toLowerCase();
  if (name.includes("test") || name.includes("sepolia") || name.includes("goerli")) {
    return "testnet";
  }
  return ROUTESCAN_DEFAULT_NETWORK;
}

function isUnsupportedAllStatus(status: number) {
  return status === 400 || status === 405 || status === 422;
}

function safeParseAbi(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
