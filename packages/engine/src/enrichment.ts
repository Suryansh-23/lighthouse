import type { Address, ChainAddressInfo, ChainId } from "@lighthouse/shared";

import type { ChainConfig } from "./chains";
import type { Logger } from "./logger";
import type { CacheStore } from "./cache";
import type { RpcClient } from "./rpc-client";

export interface EnrichmentContext {
  address: Address;
  chainId: ChainId;
  chain: ChainConfig;
  info: ChainAddressInfo;
  rpc: RpcClient;
  cache: CacheStore;
  logger: Logger;
  signal?: AbortSignal;
  code?: string;
}

export interface Enricher {
  id: string;
  priority: number;
  supports(ctx: EnrichmentContext): boolean;
  enrich(ctx: EnrichmentContext): Promise<void>;
}

export class EnrichmentPipeline {
  private readonly enrichers: Enricher[];

  constructor(enrichers: Enricher[]) {
    this.enrichers = [...enrichers].sort((a, b) => a.priority - b.priority);
  }

  async run(ctx: EnrichmentContext): Promise<void> {
    for (const enricher of this.enrichers) {
      if (ctx.signal?.aborted) {
        return;
      }

      if (!enricher.supports(ctx)) {
        continue;
      }

      try {
        await enricher.enrich(ctx);
      } catch (error) {
        ctx.logger.warn(`Enricher ${enricher.id} failed: ${formatError(error)}`);
      }
    }
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
