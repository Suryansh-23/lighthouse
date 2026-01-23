import type * as vscode from "vscode";

import type { Address, AddressResolution, ChainAddressInfo, ChainId } from "@lighthouse/shared";

import { resolveChains } from "../core/chain-config";
import { consoleLogger } from "../core/logger";
import { getSettings } from "../core/settings";
import { toAbortSignal } from "../core/cancellation";
import { CacheStore } from "../data/cache-store";
import { RpcClient } from "../data/rpc-client";
import { RpcPool } from "../data/rpc-pool";
import type { EnrichmentPipeline } from "./enrichment";

interface ResolveOptions {
  token?: vscode.CancellationToken;
}

export class AddressResolver {
  constructor(
    private readonly cache: CacheStore,
    private readonly rpcPool: RpcPool,
    private readonly pipeline: EnrichmentPipeline,
  ) {}

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
      const rpcHealth = this.rpcPool.pick(chain);
      if (!rpcHealth) {
        return { chainId: chain.chainId, reason: "no rpc configured" };
      }

      const rpc = new RpcClient(chain.chainId, rpcHealth.url);
      const signal = toAbortSignal(options.token);

      try {
        const startedAt = Date.now();
        const code = await rpc.getCode(address, signal);
        this.rpcPool.reportSuccess(chain.chainId, rpcHealth.url, Date.now() - startedAt);
        const isContract = code !== "0x";
        const info: ChainAddressInfo = {
          chainId: chain.chainId,
          chainName: chain.name,
          kind: isContract ? "Contract" : "EOA",
          exists: true,
          isContract,
        };
        perChain[chain.chainId] = info;

        await this.pipeline.run({
          address,
          chainId: chain.chainId,
          chain,
          info,
          rpc,
          cache: this.cache,
          logger: consoleLogger,
          cancel: options.token,
          code,
        });
        return { chainId: chain.chainId };
      } catch (error) {
        this.rpcPool.reportFailure(chain.chainId, rpcHealth.url);
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
