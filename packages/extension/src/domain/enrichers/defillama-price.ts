import type { Enricher, EnrichmentContext } from "../enrichment";

import type { DefiLlamaClient } from "../../data/defillama-client";

export class DefiLlamaPriceEnricher implements Enricher {
  id = "defillama-price";
  priority = 40;

  constructor(private readonly client: DefiLlamaClient) {}

  supports(ctx: EnrichmentContext): boolean {
    return ctx.info.token?.standard === "ERC20" && Boolean(ctx.chain.defillamaChainKey);
  }

  async enrich(ctx: EnrichmentContext): Promise<void> {
    if (!ctx.chain.defillamaChainKey || !ctx.info.token) {
      return;
    }

    const result = await this.client.getPrice(ctx.chain.defillamaChainKey, ctx.address);
    if (!result) {
      return;
    }

    ctx.info.token.price = {
      usd: result.price,
      source: "defillama",
      fetchedAt: new Date(result.fetchedAt).toISOString(),
    };
  }
}
