import type { ChainId } from "@lighthouse/shared";

interface RpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
}

interface RpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

export class RpcClient {
  constructor(private readonly chainId: ChainId, private readonly rpcUrl: string) {}

  async getCode(address: string, signal?: AbortSignal): Promise<string> {
    return this.request<string>("eth_getCode", [address, "latest"], signal);
  }

  async getBalance(address: string, signal?: AbortSignal): Promise<string> {
    return this.request<string>("eth_getBalance", [address, "latest"], signal);
  }

  async getTransactionCount(address: string, signal?: AbortSignal): Promise<string> {
    return this.request<string>("eth_getTransactionCount", [address, "latest"], signal);
  }

  async getStorageAt(address: string, slot: string, signal?: AbortSignal): Promise<string> {
    return this.request<string>("eth_getStorageAt", [address, slot, "latest"], signal);
  }

  async call(
    address: string,
    data: string,
    signal?: AbortSignal,
    gas?: string,
  ): Promise<string> {
    const params: Record<string, string> = { to: address, data };
    if (gas) {
      params.gas = gas;
    }
    return this.request<string>("eth_call", [params, "latest"], signal);
  }

  private async request<T>(method: string, params: unknown[], signal?: AbortSignal): Promise<T> {
    const body: RpcRequest = {
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    };

    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      throw new Error(`RPC ${this.chainId} responded with ${response.status}`);
    }

    const data = (await response.json()) as RpcResponse<T>;
    if (data.error) {
      throw new Error(`RPC ${this.chainId} error: ${data.error.message}`);
    }

    return data.result as T;
  }
}
