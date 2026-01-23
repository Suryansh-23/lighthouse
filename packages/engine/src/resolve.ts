import type { Address, AddressResolution, ChainAddressInfo, ChainId } from "@lighthouse/shared";

import type { CacheStore } from "./cache";
import type { ChainConfig } from "./chains";
import { consoleLogger, type Logger } from "./logger";
import type { EnrichmentPipeline } from "./enrichment";
import { RpcClient } from "./rpc-client";
import { RpcPool } from "./rpc-pool";

export type ScanMode = AddressResolution["scan"]["mode"];

interface ResolveOptions {
  signal?: AbortSignal;
}

interface ResolverConfig {
  cache: CacheStore;
  rpcPool: RpcPool;
  pipeline: EnrichmentPipeline;
  chains: ChainConfig[];
  scanMode: ScanMode;
  logger?: Logger;
}

export class AddressResolver {
  private readonly logger: Logger;

  constructor(private readonly config: ResolverConfig) {
    this.logger = config.logger ?? consoleLogger;
  }

  async resolve(address: Address, options: ResolveOptions = {}): Promise<AddressResolution> {
    const cached = this.config.cache.get(address);
    if (cached) {
      return cached;
    }

    const chains = this.config.chains;
    const chainIds = chains.map(chain => chain.chainId);
    const perChain: Record<ChainId, ChainAddressInfo> = {};

    const tasks = chains.map(async chain => {
      const rpcHealth = this.config.rpcPool.pick(chain);
      if (!rpcHealth) {
        return { chainId: chain.chainId, reason: "no rpc configured" };
      }

      const rpc = new RpcClient(chain.chainId, rpcHealth.url);
      try {
        const startedAt = Date.now();
        const code = await rpc.getCode(address, options.signal);
        this.config.rpcPool.reportSuccess(chain.chainId, rpcHealth.url, Date.now() - startedAt);
        const isContract = code !== "0x";
        const info: ChainAddressInfo = {
          chainId: chain.chainId,
          chainName: chain.name,
          kind: isContract ? "Contract" : "EOA",
          exists: true,
          isContract,
        };
        perChain[chain.chainId] = info;

        await this.config.pipeline.run({
          address,
          chainId: chain.chainId,
          chain,
          info,
          rpc,
          cache: this.config.cache,
          logger: this.logger,
          signal: options.signal,
          code,
        });
        return { chainId: chain.chainId };
      } catch (error) {
        this.config.rpcPool.reportFailure(chain.chainId, rpcHealth.url);
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
        mode: this.config.scanMode,
        chainsAttempted: chainIds,
        chainsSucceeded,
        chainsFailed,
      },
      perChain,
    };

    await this.config.cache.set(address, resolution);
    return resolution;
  }
}
