import type { Address } from "@lighthouse/shared";

import type { ChainConfig } from "./chains";

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

export interface ExplorerMetadata {
  verified?: boolean;
  contractName?: string;
  abi?: unknown;
  sourceUrl?: string;
}

export class ExplorerClient {
  constructor(private apiKey?: string) {}

  setApiKey(value?: string) {
    this.apiKey = value;
  }

  async getContractMetadata(chain: ChainConfig, address: Address): Promise<ExplorerMetadata | undefined> {
    if (!chain.explorer?.apiBaseUrl || !this.apiKey) {
      return undefined;
    }

    const url = new URL(chain.explorer.apiBaseUrl);
    url.searchParams.set("module", "contract");
    url.searchParams.set("action", "getsourcecode");
    url.searchParams.set("address", address);
    url.searchParams.set("apikey", this.apiKey);

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
}

function safeParseAbi(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
