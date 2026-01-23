import { getAddress } from "viem";

import type { Enricher, EnrichmentContext } from "../enrichment";

import type { ExplorerClient } from "../explorer-client";

export class ExplorerMetadataEnricher implements Enricher {
  id = "explorer-metadata";
  priority = 30;

  constructor(private readonly client: ExplorerClient) {}

  supports(ctx: EnrichmentContext): boolean {
    return ctx.info.isContract;
  }

  async enrich(ctx: EnrichmentContext): Promise<void> {
    const metadata = await this.client.getContractMetadata(ctx.chain, ctx.address);
    if (!ctx.info.contract) {
      ctx.info.contract = {};
    }

    if (metadata) {
      ctx.info.contract.metadata = {
        verified: metadata.verified,
        contractName: metadata.contractName,
        abi: metadata.abi,
        sourceUrl: metadata.sourceUrl,
      };
    }

    const creation = await this.client.getContractCreation(ctx.chain, ctx.address);
    if (creation?.contractCreator || creation?.txHash) {
      const creator = creation.contractCreator
        ? safeNormalizeAddress(creation.contractCreator)
        : undefined;
      let blockNumber: number | undefined = undefined;
      if (creation.txHash) {
        const receipt = await ctx.rpc.getTransactionReceipt(creation.txHash, ctx.signal);
        if (receipt?.blockNumber) {
          blockNumber = parseInt(receipt.blockNumber, 16);
        }
      }

      ctx.info.contract.deployment = {
        creator,
        txHash: creation.txHash ?? undefined,
        blockNumber,
      };
    }
  }
}

function safeNormalizeAddress(value: string): `0x${string}` | undefined {
  try {
    return getAddress(value);
  } catch {
    return undefined;
  }
}
