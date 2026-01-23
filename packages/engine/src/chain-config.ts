import type { ChainId } from "@lighthouse/shared";

import type { ChainConfig } from "./chains";
import { DEFAULT_CHAINS, getDefaultChainMap } from "./chains";

export type ChainMode = "workspaceLimited" | "userAll" | "singleChain";

export interface ChainSettings {
  mode: ChainMode;
  workspaceAllowlist: ChainId[];
  userChains: ChainConfig[];
}

export function resolveChains(settings: ChainSettings): ChainConfig[] {
  const chainMap = getDefaultChainMap();
  for (const chain of settings.userChains) {
    chainMap.set(chain.chainId, chain);
  }

  const candidates = Array.from(chainMap.values());
  if (settings.mode === "userAll") {
    return candidates;
  }

  if (settings.mode === "singleChain") {
    const fallback = candidates[0] ?? DEFAULT_CHAINS[0];
    const chainId = settings.workspaceAllowlist[0] ?? fallback?.chainId;
    const selected = chainMap.get(chainId as ChainId) ?? fallback;
    return selected ? [selected] : [];
  }

  const allowlist = new Set(settings.workspaceAllowlist);
  return candidates.filter(chain => allowlist.has(chain.chainId));
}

export function getChainById(chainId: ChainId, settings: ChainSettings): ChainConfig | undefined {
  const chainMap = getDefaultChainMap();
  for (const chain of settings.userChains) {
    chainMap.set(chain.chainId, chain);
  }
  return chainMap.get(chainId);
}
