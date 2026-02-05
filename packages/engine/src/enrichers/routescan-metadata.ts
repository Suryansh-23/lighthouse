import { getAddress } from "viem";

import type { Enricher, EnrichmentContext } from "../enrichment";
import type { RoutescanClient } from "../routescan-client";

export class RoutescanMetadataEnricher implements Enricher {
  id = "routescan-metadata";
  priority = 35;

  constructor(private readonly client: RoutescanClient) {}

  supports(): boolean {
    return true;
  }

  async enrich(ctx: EnrichmentContext): Promise<void> {
    const [addressSummary, contractMeta, creation] = await Promise.all([
      this.client.resolveAddressAllChains(ctx.chain, ctx.address, ctx.signal),
      ctx.info.isContract
        ? this.client.getContractMetadata(ctx.chain, ctx.address, ctx.signal)
        : Promise.resolve(undefined),
      ctx.info.isContract
        ? this.client.getContractCreation(ctx.chain, ctx.address, ctx.signal)
        : Promise.resolve(undefined),
    ]);

    if (addressSummary?.balance) {
      ctx.info.nativeBalanceWei = addressSummary.balance;
    }

    if (ctx.info.isContract) {
      if (!ctx.info.contract) {
        ctx.info.contract = {};
      }

      if (contractMeta) {
        ctx.info.contract.metadata = {
          verified: contractMeta.verified,
          contractName: contractMeta.contractName,
          abi: contractMeta.abi,
          sourceUrl: contractMeta.sourceUrl,
        };
      }

      if (creation?.contractCreator || creation?.txHash) {
        ctx.info.contract.deployment = {
          creator: creation.contractCreator
            ? safeNormalizeAddress(creation.contractCreator)
            : undefined,
          txHash: creation.txHash ?? undefined,
        };
      }
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
