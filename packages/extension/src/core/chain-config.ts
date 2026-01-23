import type { ChainId } from "@lighthouse/shared";

import type { ChainConfig } from "./chains";
import { DEFAULT_CHAINS, getDefaultChainMap } from "./chains";
import type { LighthouseSettings } from "./settings";

export function resolveChains(settings: LighthouseSettings): ChainConfig[] {
  const chainMap = getDefaultChainMap();
  for (const chain of settings.chains.userChains) {
    chainMap.set(chain.chainId, chain);
  }

  const candidates = Array.from(chainMap.values());
  if (settings.chains.mode === "userAll") {
    return candidates;
  }

  if (settings.chains.mode === "singleChain") {
    const fallback = candidates[0] ?? DEFAULT_CHAINS[0];
    const chainId = settings.chains.workspaceAllowlist[0] ?? fallback?.chainId;
    const selected = chainMap.get(chainId as ChainId) ?? fallback;
    return selected ? [selected] : [];
  }

  const allowlist = new Set(settings.chains.workspaceAllowlist);
  return candidates.filter(chain => allowlist.has(chain.chainId));
}

export function getChainById(chainId: ChainId, settings: LighthouseSettings): ChainConfig | undefined {
  const chainMap = getDefaultChainMap();
  for (const chain of settings.chains.userChains) {
    chainMap.set(chain.chainId, chain);
  }
  return chainMap.get(chainId);
}
