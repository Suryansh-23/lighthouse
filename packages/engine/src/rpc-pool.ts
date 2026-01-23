import type { ChainId } from "@lighthouse/shared";

import type { ChainConfig } from "./chains";

export interface RpcPoolSettings {
  roundRobin: boolean;
  cooldownBaseMs: number;
  maxRetriesBeforeDisable: number;
}

interface RpcHealth {
  url: string;
  failures: number;
  lastFailureAt?: number;
  cooldownUntil?: number;
  ewmaLatencyMs?: number;
  disabled?: boolean;
}

export class RpcPool {
  private readonly pools = new Map<ChainId, RpcHealth[]>();
  private readonly roundRobinIndex = new Map<ChainId, number>();

  constructor(private readonly settings: RpcPoolSettings) {}

  pick(chain: ChainConfig): RpcHealth | undefined {
    const pool = this.ensurePool(chain);
    if (pool.length === 0) {
      return undefined;
    }

    const now = Date.now();
    const available = pool.filter(
      rpc => !rpc.disabled && (!rpc.cooldownUntil || rpc.cooldownUntil <= now),
    );
    const candidates = available.length > 0 ? available : pool.filter(rpc => !rpc.disabled);
    if (candidates.length === 0) {
      return undefined;
    }

    if (!this.settings.roundRobin) {
      return candidates[0];
    }

    const index = this.roundRobinIndex.get(chain.chainId) ?? 0;
    const selected = candidates[index % candidates.length];
    this.roundRobinIndex.set(chain.chainId, index + 1);
    return selected;
  }

  reportSuccess(chainId: ChainId, url: string, latencyMs: number): void {
    const rpc = this.findRpc(chainId, url);
    if (!rpc) {
      return;
    }

    const alpha = 0.2;
    rpc.ewmaLatencyMs = rpc.ewmaLatencyMs
      ? rpc.ewmaLatencyMs * (1 - alpha) + latencyMs * alpha
      : latencyMs;
  }

  reportFailure(chainId: ChainId, url: string): void {
    const rpc = this.findRpc(chainId, url);
    if (!rpc) {
      return;
    }

    rpc.failures += 1;
    rpc.lastFailureAt = Date.now();
    rpc.cooldownUntil = Date.now() + this.cooldownMs(rpc.failures);
    if (rpc.failures >= this.settings.maxRetriesBeforeDisable) {
      rpc.disabled = true;
    }
  }

  private ensurePool(chain: ChainConfig): RpcHealth[] {
    const existing = this.pools.get(chain.chainId);
    if (existing) {
      return existing;
    }

    const pool = chain.rpcs.map(url => ({
      url,
      failures: 0,
    }));
    this.pools.set(chain.chainId, pool);
    return pool;
  }

  private findRpc(chainId: ChainId, url: string): RpcHealth | undefined {
    const pool = this.pools.get(chainId);
    return pool?.find(rpc => rpc.url === url);
  }

  private cooldownMs(failures: number): number {
    const base = this.settings.cooldownBaseMs;
    return base * Math.pow(2, Math.min(failures, 6));
  }
}
