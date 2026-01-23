import type { Enricher, EnrichmentContext } from "../enrichment";

import { toAbortSignal } from "../../core/cancellation";

export class EoaBasicsEnricher implements Enricher {
  id = "eoa-basics";
  priority = 5;

  supports(ctx: EnrichmentContext): boolean {
    return !ctx.info.isContract;
  }

  async enrich(ctx: EnrichmentContext): Promise<void> {
    const signal = toAbortSignal(ctx.cancel);
    const [balance, nonce] = await Promise.all([
      ctx.rpc.getBalance(ctx.address, signal),
      ctx.rpc.getTransactionCount(ctx.address, signal),
    ]);

    ctx.info.nativeBalanceWei = balance;
    ctx.info.nonce = parseInt(nonce, 16);
  }
}
