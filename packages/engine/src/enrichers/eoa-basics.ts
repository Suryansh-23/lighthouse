import type { Enricher, EnrichmentContext } from "../enrichment";

export class EoaBasicsEnricher implements Enricher {
  id = "eoa-basics";
  priority = 5;

  supports(ctx: EnrichmentContext): boolean {
    return !ctx.info.isContract;
  }

  async enrich(ctx: EnrichmentContext): Promise<void> {
    const [balance, nonce] = await Promise.all([
      ctx.rpc.getBalance(ctx.address, ctx.signal),
      ctx.rpc.getTransactionCount(ctx.address, ctx.signal),
    ]);

    ctx.info.nativeBalanceWei = balance;
    ctx.info.nonce = parseInt(nonce, 16);
  }
}
