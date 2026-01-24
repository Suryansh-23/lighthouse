import {
  decodeFunctionResult,
  encodeFunctionData,
  hexToString,
  parseAbi,
  type Address as ViemAddress,
  type Hex,
} from "viem";

import type { Enricher, EnrichmentContext } from "../enrichment";

const ERC165_ABI = parseAbi(["function supportsInterface(bytes4 interfaceId) view returns (bool)"]);
const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);
const ERC20_BYTES32_ABI = parseAbi([
  "function name() view returns (bytes32)",
  "function symbol() view returns (bytes32)",
]);
const ERC4626_ABI = parseAbi([
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
]);

const ERC721_INTERFACE = "0x80ac58cd";
const ERC1155_INTERFACE = "0xd9b67a26";

const DEFAULT_GAS = "0x186a0";

export class ErcDetectorEnricher implements Enricher {
  id = "erc-detector";
  priority = 20;

  supports(ctx: EnrichmentContext): boolean {
    return ctx.info.isContract;
  }

  async enrich(ctx: EnrichmentContext): Promise<void> {
    const supports721 = await supportsInterface(ctx, ERC721_INTERFACE);
    const supports1155 = await supportsInterface(ctx, ERC1155_INTERFACE);

    if (supports1155) {
      const [name, symbol] = await Promise.all([
        callTokenString(ctx, "name"),
        callTokenString(ctx, "symbol"),
      ]);
      updateClassification(ctx, "ERC1155", 0.9);
      ctx.info.token = {
        standard: "ERC1155",
        name: name ?? undefined,
        symbol: symbol ?? undefined,
      };
      return;
    }

    if (supports721) {
      const [name, symbol] = await Promise.all([
        callTokenString(ctx, "name"),
        callTokenString(ctx, "symbol"),
      ]);
      updateClassification(ctx, "ERC721", 0.9);
      ctx.info.token = {
        standard: "ERC721",
        name: name ?? undefined,
        symbol: symbol ?? undefined,
      };
      return;
    }

    const [name, symbol, decimals, totalSupply] = await Promise.all([
      callTokenString(ctx, "name"),
      callTokenString(ctx, "symbol"),
      callNumber(ctx, ERC20_ABI, "decimals"),
      callBigInt(ctx, ERC20_ABI, "totalSupply"),
    ]);

    let detectedStandard: "ERC20" | "ERC4626" | undefined = undefined;
    if (decimals !== undefined || totalSupply !== undefined || name || symbol) {
      detectedStandard = "ERC20";
    }

    const asset = await callAddress(ctx, ERC4626_ABI, "asset");
    const totalAssets = await callBigInt(ctx, ERC4626_ABI, "totalAssets");
    if (asset && totalAssets !== undefined) {
      detectedStandard = "ERC4626";
    }

    if (detectedStandard) {
      updateClassification(ctx, detectedStandard, 0.8);
      ctx.info.token = {
        standard: detectedStandard,
        name: name ?? undefined,
        symbol: symbol ?? undefined,
        decimals: decimals ?? undefined,
        totalSupply: totalSupply ? totalSupply.toString() : undefined,
        asset: asset ?? undefined,
        totalAssets: totalAssets ? totalAssets.toString() : undefined,
      };
    }
  }
}

function updateClassification(
  ctx: EnrichmentContext,
  type: "ERC20" | "ERC721" | "ERC1155" | "ERC4626",
  confidence: number,
) {
  if (!ctx.info.contract) {
    ctx.info.contract = {};
  }

  if (ctx.info.contract.classification?.type === "Proxy") {
    return;
  }

  ctx.info.contract.classification = { type, confidence };
}

async function supportsInterface(ctx: EnrichmentContext, interfaceId: Hex): Promise<boolean> {
  const data = encodeFunctionData({
    abi: ERC165_ABI,
    functionName: "supportsInterface",
    args: [interfaceId],
  });
  const result = await safeCall(ctx, data);
  if (!result) {
    return false;
  }

  try {
    const decoded = decodeFunctionResult({
      abi: ERC165_ABI,
      functionName: "supportsInterface",
      data: result,
    });
    const supported = unwrapResult(decoded);
    return Boolean(supported);
  } catch {
    return false;
  }
}

async function callTokenString(ctx: EnrichmentContext, name: "name" | "symbol") {
  const [primary, fallback] = await Promise.all([
    callString(ctx, ERC20_ABI, name),
    callBytes32String(ctx, ERC20_BYTES32_ABI, name),
  ]);

  const normalizedPrimary = normalizeTokenString(primary);
  const normalizedFallback = normalizeTokenString(fallback);
  if (!normalizedPrimary) {
    return normalizedFallback;
  }
  if (!normalizedFallback) {
    return normalizedPrimary;
  }

  const primaryScore = scoreTokenString(normalizedPrimary, name);
  const fallbackScore = scoreTokenString(normalizedFallback, name);
  return fallbackScore > primaryScore ? normalizedFallback : normalizedPrimary;
}

function normalizeTokenString(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.replace(/\u0000/g, "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function scoreTokenString(value: string, kind: "name" | "symbol"): number {
  let score = Math.min(value.length, 12) * 0.1;
  if (kind === "symbol") {
    if (/^[A-Za-z0-9.$-]+$/.test(value)) {
      score += 4;
    }
    if (value.length <= 8) {
      score += 3;
    }
    if (value.length <= 2) {
      score -= 4;
    }
    if (/\s/.test(value)) {
      score -= 3;
    }
  } else {
    if (value.length >= 3) {
      score += 2;
    }
    if (/\s/.test(value)) {
      score += 1;
    }
  }
  return score;
}

function unwrapResult(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

async function callString(
  ctx: EnrichmentContext,
  abi: typeof ERC20_ABI,
  name: string,
): Promise<string | undefined> {
  const data = encodeFunctionData({ abi, functionName: name as never });
  const result = await safeCall(ctx, data);
  if (!result) {
    return undefined;
  }

  try {
    const decoded = decodeFunctionResult({
      abi,
      functionName: name as never,
      data: result,
    });
    const value = unwrapResult(decoded);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

async function callBytes32String(
  ctx: EnrichmentContext,
  abi: typeof ERC20_BYTES32_ABI,
  name: string,
): Promise<string | undefined> {
  const data = encodeFunctionData({ abi, functionName: name as never });
  const result = await safeCall(ctx, data);
  if (!result) {
    return undefined;
  }

  try {
    const decoded = decodeFunctionResult({
      abi,
      functionName: name as never,
      data: result,
    });
    const value = unwrapResult(decoded);
    if (typeof value !== "string") {
      return undefined;
    }
    const text = hexToString(value as Hex, { size: 32 }).replace(/\u0000/g, "");
    return text.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function callNumber(
  ctx: EnrichmentContext,
  abi: typeof ERC20_ABI,
  name: string,
): Promise<number | undefined> {
  const data = encodeFunctionData({ abi, functionName: name as never });
  const result = await safeCall(ctx, data);
  if (!result) {
    return undefined;
  }

  try {
    const decoded = decodeFunctionResult({
      abi,
      functionName: name as never,
      data: result,
    });
    const value = unwrapResult(decoded);
    if (typeof value === "bigint") {
      return Number(value);
    }
    return typeof value === "number" ? value : undefined;
  } catch {
    return undefined;
  }
}

async function callBigInt(
  ctx: EnrichmentContext,
  abi: typeof ERC20_ABI | typeof ERC4626_ABI,
  name: string,
): Promise<bigint | undefined> {
  const data = encodeFunctionData({ abi, functionName: name as never });
  const result = await safeCall(ctx, data);
  if (!result) {
    return undefined;
  }

  try {
    const decoded = decodeFunctionResult({
      abi,
      functionName: name as never,
      data: result,
    });
    const value = unwrapResult(decoded);
    return typeof value === "bigint" ? value : undefined;
  } catch {
    return undefined;
  }
}

async function callAddress(
  ctx: EnrichmentContext,
  abi: typeof ERC4626_ABI,
  name: string,
): Promise<ViemAddress | undefined> {
  const data = encodeFunctionData({ abi, functionName: name as never });
  const result = await safeCall(ctx, data);
  if (!result) {
    return undefined;
  }

  try {
    const decoded = decodeFunctionResult({
      abi,
      functionName: name as never,
      data: result,
    });
    const value = unwrapResult(decoded);
    return typeof value === "string" ? (value as ViemAddress) : undefined;
  } catch {
    return undefined;
  }
}

async function safeCall(ctx: EnrichmentContext, data: Hex): Promise<Hex | undefined> {
  try {
    return (await ctx.rpc.call(ctx.address, data, ctx.signal, DEFAULT_GAS)) as Hex;
  } catch {
    return undefined;
  }
}
