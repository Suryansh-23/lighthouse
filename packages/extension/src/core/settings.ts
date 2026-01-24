import * as vscode from "vscode";

import type { ChainId } from "@lighthouse/shared";

import type { ChainConfig, ChainMode, ExplorerKind, RpcPoolSettings } from "@lighthouse/engine";

export interface LighthouseSettings {
  enabled: boolean;
  detection: {
    fileGlobs: string[];
  };
  ui: {
    hover: { enabled: boolean };
    codelens: { enabled: boolean };
  };
  chains: {
    mode: ChainMode;
    workspaceAllowlist: ChainId[];
    userChains: ChainConfig[];
  };
  rpc: RpcPoolSettings;
  explorer: {
    default: ExplorerKind;
    apiKeys: Partial<Record<ExplorerKind, string>>;
  };
  cache: {
    ttlSeconds: number;
  };
  net: {
    maxConcurrentRequests: number;
  };
  security: {
    respectWorkspaceTrust: boolean;
  };
}

export function getSettings(): LighthouseSettings {
  const config = vscode.workspace.getConfiguration("lighthouse");
  return {
    enabled: config.get("enabled", true),
    detection: {
      fileGlobs: config.get("detection.fileGlobs", [
        "**/*.{ts,tsx,js,jsx,sol,rs,go,py,yml,yaml,json,toml,md}",
      ]),
    },
    ui: {
      hover: {
        enabled: config.get("ui.hover.enabled", true),
      },
      codelens: {
        enabled: config.get("ui.codelens.enabled", true),
      },
    },
    chains: {
      mode: config.get("chains.mode", "workspaceLimited"),
      workspaceAllowlist: config.get("chains.workspaceAllowlist", [1, 10, 137, 42161, 8453, 100]),
      userChains: config.get("chains.userChains", []),
    },
    rpc: {
      roundRobin: config.get("rpc.roundRobin", true),
      cooldownBaseMs: config.get("rpc.cooldownBaseMs", 1000),
      maxRetriesBeforeDisable: config.get("rpc.maxRetriesBeforeDisable", 10),
    },
    explorer: {
      default: config.get("explorer.default", "routescan"),
      apiKeys: {
        routescan: config.get("explorer.apiKeys.routescan", ""),
        etherscan: config.get("explorer.apiKeys.etherscan", ""),
        blockscout: config.get("explorer.apiKeys.blockscout", ""),
      },
    },
    cache: {
      ttlSeconds: config.get("cache.ttlSeconds", 60 * 60 * 24),
    },
    net: {
      maxConcurrentRequests: config.get("net.maxConcurrentRequests", 8),
    },
    security: {
      respectWorkspaceTrust: config.get("security.respectWorkspaceTrust", true),
    },
  };
}
