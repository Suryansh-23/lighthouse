import type { Enricher, EnrichmentContext } from "../enrichment";

import type { ExplorerClient } from "../../data/explorer-client";

export class ExplorerMetadataEnricher implements Enricher {
  id = "explorer-metadata";
  priority = 30;

  constructor(private readonly client: ExplorerClient) {}

  supports(ctx: EnrichmentContext): boolean {
    return ctx.info.isContract;
  }

  async enrich(ctx: EnrichmentContext): Promise<void> {
    const metadata = await this.client.getContractMetadata(ctx.chain, ctx.address);
    if (!metadata) {
      return;
    }

    if (!ctx.info.contract) {
      ctx.info.contract = {};
    }

    ctx.info.contract.metadata = {
      verified: metadata.verified,
      contractName: metadata.contractName,
      abi: metadata.abi,
      sourceUrl: metadata.sourceUrl,
    };
  }
}
