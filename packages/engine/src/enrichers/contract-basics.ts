import { getAddress, keccak256, type Hex } from "viem";

import type { Enricher, EnrichmentContext } from "../enrichment";

const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export class ContractBasicsEnricher implements Enricher {
  id = "contract-basics";
  priority = 10;

  supports(ctx: EnrichmentContext): boolean {
    return ctx.info.isContract;
  }

  async enrich(ctx: EnrichmentContext): Promise<void> {
    const code = ctx.code ?? (await ctx.rpc.getCode(ctx.address, ctx.signal));
    const bytecodeHash = code && code !== "0x" ? keccak256(code as Hex) : undefined;

    if (!ctx.info.contract) {
      ctx.info.contract = {};
    }

    if (bytecodeHash) {
      ctx.info.contract.bytecodeHash = bytecodeHash;
    }

    const proxy = await detectProxy(ctx);
    if (proxy) {
      ctx.info.contract.proxy = proxy;
      ctx.info.contract.classification = {
        type: "Proxy",
        confidence: 0.7,
        proxyType: proxy.type,
      };
    }
  }
}

async function detectProxy(ctx: EnrichmentContext) {
  const slotValue = await ctx.rpc.getStorageAt(
    ctx.address,
    EIP1967_IMPLEMENTATION_SLOT,
    ctx.signal,
  );
  const normalized = normalizeSlotAddress(slotValue);
  if (!normalized) {
    return undefined;
  }

  return {
    type: "EIP1967" as const,
    implementation: normalized,
  };
}

function normalizeSlotAddress(value: string): `0x${string}` | undefined {
  if (!value || value === "0x") {
    return undefined;
  }

  const trimmed = value.replace(/^0x/, "").padStart(64, "0");
  const addressHex = trimmed.slice(-40);
  if (/^0+$/.test(addressHex)) {
    return undefined;
  }

  try {
    return getAddress(`0x${addressHex}`);
  } catch {
    return undefined;
  }
}
