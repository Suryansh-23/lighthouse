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
  backgroundPipeline?: EnrichmentPipeline;
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
    const chains = this.config.chains;
    const chainIds = chains.map((chain) => chain.chainId);
    const cached = this.config.cache.get(address);
    if (cached && !shouldRefresh(cached, chainIds)) {
      return cached;
    }

    const perChain: Record<ChainId, ChainAddressInfo> = {};
    const rpcByChain = new Map<ChainId, RpcClient>();
    const codeByChain = new Map<ChainId, string>();

    const tasks = chains.map(async (chain) => {
      const preferredRpc = this.config.rpcPool.pick(chain);
      const rpcUrls = preferredRpc
        ? [preferredRpc.url, ...chain.rpcs.filter((url) => url !== preferredRpc.url)]
        : chain.rpcs;
      let lastError: string | undefined;

      for (const rpcUrl of rpcUrls) {
        const rpc = new RpcClient(chain.chainId, rpcUrl);
        try {
          const startedAt = Date.now();
          const code = await rpc.getCode(address, options.signal);
          this.config.rpcPool.reportSuccess(chain.chainId, rpcUrl, Date.now() - startedAt);
          rpcByChain.set(chain.chainId, rpc);
          codeByChain.set(chain.chainId, code);
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
          this.config.rpcPool.reportFailure(chain.chainId, rpcUrl);
          lastError = error instanceof Error ? error.message : "unknown error";
        }
      }

      return {
        chainId: chain.chainId,
        reason: lastError ?? "no rpc configured",
      };
    });

    const results = await Promise.all(tasks);
    const chainsSucceeded = results
      .filter((result) => !result.reason)
      .map((result) => result.chainId);
    const chainsFailed = results
      .filter((result) => result.reason)
      .map((result) => ({
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
    if (this.config.backgroundPipeline) {
      void this.runBackgroundEnrichment(address, resolution, rpcByChain, codeByChain);
    }
    return resolution;
  }

  private async runBackgroundEnrichment(
    address: Address,
    resolution: AddressResolution,
    rpcByChain: Map<ChainId, RpcClient>,
    codeByChain: Map<ChainId, string>,
  ): Promise<void> {
    const pipeline = this.config.backgroundPipeline;
    if (!pipeline) {
      return;
    }

    const chainMap = new Map(this.config.chains.map((chain) => [chain.chainId, chain] as const));
    const tasks = Object.values(resolution.perChain).map(async (info) => {
      const chain = chainMap.get(info.chainId);
      const rpc = rpcByChain.get(info.chainId);
      if (!chain || !rpc) {
        return;
      }

      try {
        await pipeline.run({
          address,
          chainId: info.chainId,
          chain,
          info,
          rpc,
          cache: this.config.cache,
          logger: this.logger,
          code: codeByChain.get(info.chainId),
        });
      } catch (error) {
        this.logger.warn(
          `Background enrichers failed: ${error instanceof Error ? error.message : error}`,
        );
      }
    });

    await Promise.allSettled(tasks);
    await this.config.cache.set(address, resolution);
  }
}

function shouldRefresh(resolution: AddressResolution, chainIds: ChainId[]): boolean {
  if (resolution.scan.chainsFailed.length > 0) {
    return true;
  }
  return chainIds.some((chainId) => !resolution.perChain[chainId]);
}
