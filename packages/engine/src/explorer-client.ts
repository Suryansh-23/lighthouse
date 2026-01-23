import type { Address } from "@lighthouse/shared";

import type { ChainConfig, ExplorerKind } from "./chains";

interface ExplorerSourceResult {
  ContractName?: string;
  ABI?: string;
  SourceCode?: string;
}

interface ExplorerResponse {
  status: string;
  message: string;
  result: ExplorerSourceResult[];
}

interface ContractCreationResult {
  contractAddress?: string;
  contractCreator?: string;
  txHash?: string;
}

interface ContractCreationResponse {
  status: string;
  message: string;
  result: ContractCreationResult[];
}

export interface ExplorerMetadata {
  verified?: boolean;
  contractName?: string;
  abi?: unknown;
  sourceUrl?: string;
}

export class ExplorerClient {
  private readonly apiKeys = new Map<ExplorerKind, string>();

  constructor(initial?: Partial<Record<ExplorerKind, string>>) {
    if (initial) {
      for (const [kind, value] of Object.entries(initial)) {
        if (value) {
          this.apiKeys.set(kind as ExplorerKind, value);
        }
      }
    }
  }

  setApiKey(kind: ExplorerKind, value?: string) {
    if (!value) {
      this.apiKeys.delete(kind);
      return;
    }

    this.apiKeys.set(kind, value);
  }

  async getContractMetadata(chain: ChainConfig, address: Address): Promise<ExplorerMetadata | undefined> {
    if (!chain.explorer?.apiBaseUrl) {
      return undefined;
    }

    const apiKey = chain.explorer.kind ? this.apiKeys.get(chain.explorer.kind) : undefined;
    if (!apiKey) {
      return undefined;
    }

    const url = new URL(chain.explorer.apiBaseUrl);
    url.searchParams.set("module", "contract");
    url.searchParams.set("action", "getsourcecode");
    url.searchParams.set("address", address);
    url.searchParams.set("apikey", apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as ExplorerResponse;
    if (payload.status !== "1" || !payload.result?.length) {
      return undefined;
    }

    const result = payload.result[0];
    const verified = result.ABI ? !result.ABI.includes("Contract source code not verified") : false;

    return {
      verified,
      contractName: result.ContractName,
      abi: verified && result.ABI ? safeParseAbi(result.ABI) : undefined,
      sourceUrl: chain.explorer.baseUrl ? `${chain.explorer.baseUrl}/address/${address}` : undefined,
    };
  }

  async getContractCreation(chain: ChainConfig, address: Address): Promise<ContractCreationResult | undefined> {
    if (!chain.explorer?.apiBaseUrl) {
      return undefined;
    }

    const apiKey = chain.explorer.kind ? this.apiKeys.get(chain.explorer.kind) : undefined;
    if (!apiKey) {
      return undefined;
    }

    const url = new URL(chain.explorer.apiBaseUrl);
    url.searchParams.set("module", "contract");
    url.searchParams.set("action", "getcontractcreation");
    url.searchParams.set("contractaddresses", address);
    url.searchParams.set("apikey", apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as ContractCreationResponse;
    if (payload.status !== "1" || !payload.result?.length) {
      return undefined;
    }

    return payload.result[0];
  }
}

function safeParseAbi(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
