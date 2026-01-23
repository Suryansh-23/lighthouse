import type * as vscode from "vscode";

import type { Address, AddressResolution, ChainAddressInfo, ChainId } from "@lighthouse/shared";

import { resolveChains } from "../core/chain-config";
import { getSettings } from "../core/settings";
import { toAbortSignal } from "../core/cancellation";
import { CacheStore } from "../data/cache-store";
import { RpcClient } from "../data/rpc-client";

interface ResolveOptions {
  token?: vscode.CancellationToken;
}

export class AddressResolver {
  constructor(private readonly cache: CacheStore) {}

  async resolve(address: Address, options: ResolveOptions = {}): Promise<AddressResolution> {
    const cached = this.cache.get(address);
    if (cached) {
      return cached;
    }

    const settings = getSettings();
    const chains = resolveChains(settings);
    const chainIds = chains.map(chain => chain.chainId);
    const perChain: Record<ChainId, ChainAddressInfo> = {};

    const tasks = chains.map(async chain => {
      const rpcUrl = chain.rpcs[0];
      if (!rpcUrl) {
        return { chainId: chain.chainId, reason: "no rpc configured" };
      }

      const rpc = new RpcClient(chain.chainId, rpcUrl);
      const signal = toAbortSignal(options.token);

      try {
        const code = await rpc.getCode(address, signal);
        const isContract = code !== "0x";
        const info: ChainAddressInfo = {
          chainId: chain.chainId,
          chainName: chain.name,
          kind: isContract ? "Contract" : "EOA",
          exists: true,
          isContract,
        };
        perChain[chain.chainId] = info;
        return { chainId: chain.chainId };
      } catch (error) {
        return {
          chainId: chain.chainId,
          reason: error instanceof Error ? error.message : "unknown error",
        };
      }
    });

    const results = await Promise.all(tasks);
    const chainsSucceeded = results
      .filter(result => !result.reason)
      .map(result => result.chainId);
    const chainsFailed = results
      .filter(result => result.reason)
      .map(result => ({
        chainId: result.chainId,
        reason: result.reason ?? "unknown error",
      }));

    const resolution: AddressResolution = {
      address,
      scannedAt: new Date().toISOString(),
      scan: {
        mode: mapScanMode(settings.chains.mode),
        chainsAttempted: chainIds,
        chainsSucceeded,
        chainsFailed,
      },
      perChain,
    };

    await this.cache.set(address, resolution);
    return resolution;
  }
}

function mapScanMode(mode: "workspaceLimited" | "userAll" | "singleChain"): AddressResolution["scan"]["mode"] {
  switch (mode) {
    case "userAll":
      return "userChains";
    case "singleChain":
      return "singleChain";
    default:
      return "workspaceChains";
  }
}
